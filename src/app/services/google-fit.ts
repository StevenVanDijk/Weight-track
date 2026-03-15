import { Injectable, signal, computed, inject } from '@angular/core';
import { WeightEntry } from '../models/weight-entry';
import { DbService } from '../db';

export type GoogleFitStatus = 'idle' | 'connecting' | 'syncing' | 'success' | 'error';

const SETTINGS_KEY = 'weight_google_fit';
const FITNESS_API = 'https://www.googleapis.com/fitness/v1/users/me';
// Merged weight data source provided by Google Fit (read-only, all apps contribute)
const MERGED_SOURCE = 'derived:com.google.weight:com.google.android.gms:merge_weight';
// Required OAuth scopes for reading and writing body data
const SCOPES = 'https://www.googleapis.com/auth/fitness.body.read https://www.googleapis.com/auth/fitness.body.write';

export interface GoogleFitSettings {
  clientId: string;
  lastSyncDate: string | null;
  /** IDs of WeightEntry records already written to Google Fit — prevents duplicate writes. */
  syncedEntryIds: string[];
  /** Persisted OAuth access token. Null when disconnected or cleared by disconnect(). */
  accessToken: string | null;
  /** Unix timestamp in ms after which accessToken is considered expired. */
  tokenExpiry: number | null;
}

@Injectable({ providedIn: 'root' })
export class GoogleFitService {
  private readonly db = inject(DbService);
  private _settings = signal<GoogleFitSettings>(this.loadSettings());
  // Restore persisted token on startup if it has not yet expired.
  private _accessToken = signal<string | null>(this.getValidStoredToken());
  private _status = signal<GoogleFitStatus>('idle');
  private _message = signal<string>('');
  private _importedCount = signal<number>(0);
  private _exportedCount = signal<number>(0);

  readonly settings = this._settings.asReadonly();
  readonly isConnected = computed(() => this._accessToken() !== null);
  readonly status = this._status.asReadonly();
  readonly message = this._message.asReadonly();
  readonly importedCount = this._importedCount.asReadonly();
  readonly exportedCount = this._exportedCount.asReadonly();

  setClientId(clientId: string): void {
    const updated: GoogleFitSettings = { ...this._settings(), clientId: clientId.trim() };
    this._settings.set(updated);
    this.saveSettings();
  }

  /**
   * The redirect URI used for the OAuth redirect flow (standalone PWA mode).
   * Must be added as an Authorised redirect URI in Google Cloud Console.
   */
  get redirectUri(): string {
    return window.location.origin + '/sync';
  }

  async connect(): Promise<void> {
    // If already connected with a valid token, nothing to do.
    if (this._accessToken()) {
      this._status.set('idle');
      this._message.set('Already connected to Google Fit.');
      return;
    }

    const clientId = this._settings().clientId;
    if (!clientId) {
      this._status.set('error');
      this._message.set('Enter your Google Client ID first.');
      return;
    }

    this._status.set('connecting');
    this._message.set('Opening Google sign-in…');

    try {
      await this.loadGsiScript();

      if (this.isStandalonePwa()) {
        // In standalone PWA mode the popup's window.opener is null so GIS cannot
        // post the token back. Use redirect flow instead — the page navigates away
        // and handleRedirectCallback() picks up the token on return.
        this.startRedirectFlow(clientId);
        // Execution stops here; the browser navigates to Google.
      } else {
        const { token, expiresIn } = await this.requestTokenViaPopup(clientId);
        this.persistToken(token, expiresIn);
        this._status.set('idle');
        this._message.set('Connected to Google Fit.');
      }
    } catch (err: unknown) {
      this.clearToken();
      this._status.set('error');
      this._message.set(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  /**
   * Call this when the Sync page initialises.  If the user just returned from
   * the Google OAuth redirect (token or error is in the URL), this method will
   * process the response and update the service state accordingly.
   */
  async handleRedirectCallback(): Promise<void> {
    const hash = window.location.hash;
    const search = window.location.search;

    // Google returns errors either as a hash fragment or query parameter.
    const errorMatch = hash.match(/[#&]error=([^&]+)/) ?? search.match(/[?&]error=([^&]+)/);
    if (errorMatch) {
      const errorCode = decodeURIComponent(errorMatch[1]);
      history.replaceState(null, '', window.location.pathname);
      this._status.set('error');
      if (errorCode === 'access_denied') {
        this._message.set(
          'Google sign-in was blocked (access_denied). ' +
          'The app has not completed Google\'s verification process. ' +
          'Add your Google account as a test user in the OAuth consent screen of your Google Cloud Console project.'
        );
      } else {
        this._message.set(`Google sign-in failed: ${errorCode}`);
      }
      return;
    }

    if (!hash.includes('access_token')) {
      // Auth flow was in progress but no token arrived — let the user retry.
      if (this._status() === 'connecting') {
        this._status.set('error');
        this._message.set('Sign-in did not complete. Please try connecting again.');
      }
      return;
    }

    const clientId = this._settings().clientId;
    if (!clientId) return;

    // Parse the access token and expiry directly from the hash fragment (OAuth 2.0 implicit flow).
    const params = new URLSearchParams(hash.substring(1)); // strip leading '#'
    const token = params.get('access_token');
    const expiresIn = Number(params.get('expires_in') ?? '3599');
    if (token) {
      this.persistToken(token, expiresIn);
      this._status.set('idle');
      this._message.set('Connected to Google Fit.');
      // Remove the fragment so a page refresh doesn't re-process it.
      history.replaceState(null, '', window.location.pathname);
    }
  }

  disconnect(): void {
    const token = this._accessToken();
    if (token && (window as any).google?.accounts?.oauth2) {
      (window as any).google.accounts.oauth2.revoke(token, () => {});
    }
    this.clearToken();
    this._status.set('idle');
    this._message.set('Disconnected from Google Fit.');
  }

  /**
   * Re-reads settings from localStorage and applies any token that was written
   * there by another browser context — specifically a Chrome Custom Tab that
   * handled the OAuth redirect on Android PWA.  The CCT boots a fresh Angular
   * instance, which calls handleRedirectCallback() and persists the token to
   * localStorage; when the CCT closes and the PWA comes to the foreground this
   * method picks up that token.
   *
   * Returns true if a new valid token was found and applied.
   */
  refreshFromStorage(): boolean {
    const fresh = this.loadSettings();
    this._settings.set(fresh);
    const { accessToken, tokenExpiry } = fresh;
    const hasValidToken = !!(accessToken && tokenExpiry && Date.now() < tokenExpiry);
    if (hasValidToken && !this._accessToken()) {
      this._accessToken.set(accessToken!);
      this._status.set('idle');
      this._message.set('Connected to Google Fit.');
      return true;
    }
    return false;
  }

  /**
   * Pull weight entries from Google Fit and merge them into the app.
   * Calls `addEntry` for each new data point (WeightService.addEntry handles dedup by date).
   * Returns the number of entries imported.
   */
  async importFromGoogleFit(addEntry: (e: Omit<WeightEntry, 'id'>) => void): Promise<number> {
    const token = this._accessToken();
    if (!token) { this._message.set('Not connected.'); return 0; }

    this._status.set('syncing');
    this._message.set('Fetching weight data from Google Fit…');

    try {
      const endMs = Date.now();
      const startMs = endMs - 365 * 24 * 60 * 60 * 1000; // last 12 months
      const startNs = String(startMs * 1_000_000);
      const endNs = String(endMs * 1_000_000);

      const url = `${FITNESS_API}/dataSources/${MERGED_SOURCE}/datasets/${startNs}-${endNs}`;
      let res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // If the token expired mid-session, attempt a silent refresh and retry once.
      if (res.status === 401) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          res = await fetch(url, {
            headers: { Authorization: `Bearer ${this._accessToken()!}` },
          });
        }
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Google Fit API error ${res.status}: ${body}`);
      }

      const data = await res.json();
      const points: any[] = data.point ?? [];
      let count = 0;

      for (const point of points) {
        const weightKg: number | undefined = point.value?.[0]?.fpVal;
        const startTimeNs: string | undefined = point.startTimeNanos;
        if (weightKg == null || !startTimeNs) continue;

        const dateMs = Math.round(Number(startTimeNs) / 1_000_000);
        const date = new Date(dateMs).toISOString().split('T')[0];
        const weight = Math.round(weightKg * 10) / 10;

        addEntry({ date, weight });
        count++;
      }

      const synced = new Date().toISOString();
      this._settings.set({ ...this._settings(), lastSyncDate: synced });
      this.saveSettings();

      this._importedCount.set(count);
      this._status.set('success');
      this._message.set(`Imported ${count} entr${count === 1 ? 'y' : 'ies'} from Google Fit.`);
      return count;
    } catch (err: unknown) {
      this._status.set('error');
      this._message.set(err instanceof Error ? err.message : 'Import failed.');
      return 0;
    }
  }

  /**
   * Syncs a single entry to Google Fit if connected and not already synced.
   * Designed for fire-and-forget use immediately after logging a new weight.
   * Silently no-ops when disconnected or when the entry has already been pushed.
   */
  async syncEntry(entry: WeightEntry): Promise<void> {
    const token = this._accessToken();
    if (!token) return;

    const settings = this._settings();
    if (settings.syncedEntryIds.includes(entry.id)) return;

    try {
      const dataSourceId = await this.ensureDataSource(token);
      const ms = new Date(entry.date).getTime();
      const ns = String(ms * 1_000_000);

      const patchRes = await fetch(
        `${FITNESS_API}/dataSources/${encodeURIComponent(dataSourceId)}/datasets/${ns}-${ns}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dataSourceId,
            minStartTimeNs: ns,
            maxEndTimeNs: ns,
            point: [{
              dataTypeName: 'com.google.weight',
              startTimeNanos: ns,
              endTimeNanos: ns,
              value: [{ fpVal: entry.weight }],
            }],
          }),
        }
      );

      if (!patchRes.ok) return; // silent failure — user can manually export later

      const updatedIds = [...this._settings().syncedEntryIds, entry.id];
      this._settings.set({ ...this._settings(), syncedEntryIds: updatedIds });
      this.saveSettings();
    } catch {
      // Silent failure for background auto-sync
    }
  }

  /**
   * Push all local weight entries to Google Fit.
   * Creates a custom data source on first run, then patches the dataset.
   * Returns the number of entries exported.
   */
  async exportToGoogleFit(entries: WeightEntry[]): Promise<number> {
    const token = this._accessToken();
    if (!token) { this._message.set('Not connected.'); return 0; }
    if (entries.length === 0) { this._message.set('No entries to export.'); return 0; }

    this._status.set('syncing');
    this._message.set('Pushing entries to Google Fit…');

    try {
      const dataSourceId = await this.ensureDataSource(token);

      // Build dataset time range
      const times = entries.map(e => new Date(e.date).getTime());
      const minMs = Math.min(...times);
      const maxMs = Math.max(...times);
      const minNs = String(minMs * 1_000_000);
      const maxNs = String(maxMs * 1_000_000);

      const points = entries.map(e => {
        const ms = new Date(e.date).getTime();
        const ns = String(ms * 1_000_000);
        return {
          dataTypeName: 'com.google.weight',
          startTimeNanos: ns,
          endTimeNanos: ns,
          value: [{ fpVal: e.weight }],
        };
      });

      const patchUrl = `${FITNESS_API}/dataSources/${encodeURIComponent(dataSourceId)}/datasets/${minNs}-${maxNs}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataSourceId,
          minStartTimeNs: minNs,
          maxEndTimeNs: maxNs,
          point: points,
        }),
      });

      if (!patchRes.ok) {
        const body = await patchRes.text();
        throw new Error(`Export error ${patchRes.status}: ${body}`);
      }

      const synced = new Date().toISOString();
      const allIds = entries.map(e => e.id);
      this._settings.set({ ...this._settings(), lastSyncDate: synced, syncedEntryIds: allIds });
      this.saveSettings();

      const count = entries.length;
      this._exportedCount.set(count);
      this._status.set('success');
      this._message.set(`Exported ${count} entr${count === 1 ? 'y' : 'ies'} to Google Fit.`);
      return count;
    } catch (err: unknown) {
      this._status.set('error');
      this._message.set(err instanceof Error ? err.message : 'Export failed.');
      return 0;
    }
  }

  /**
   * Called by APP_INITIALIZER. Restores Google Fit settings (including any
   * persisted token) from IndexedDB if localStorage was cleared.
   */
  async restoreFromDb(): Promise<void> {
    if (localStorage.getItem(SETTINGS_KEY)) return;
    const raw = await this.db.read(SETTINGS_KEY);
    if (raw && typeof raw === 'object') {
      const s = raw as GoogleFitSettings;
      const restored: GoogleFitSettings = {
        clientId: s.clientId ?? '',
        lastSyncDate: s.lastSyncDate ?? null,
        syncedEntryIds: Array.isArray(s.syncedEntryIds) ? s.syncedEntryIds : [],
        accessToken: s.accessToken ?? null,
        tokenExpiry: s.tokenExpiry ?? null,
      };
      this._settings.set(restored);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(restored));
      // Restore token signal if the recovered token is still valid.
      const valid = this.getValidStoredToken();
      if (valid) this._accessToken.set(valid);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Returns the stored token if it has not expired yet, otherwise null. */
  private getValidStoredToken(): string | null {
    const s = this._settings();
    if (s.accessToken && s.tokenExpiry && Date.now() < s.tokenExpiry) {
      return s.accessToken;
    }
    return null;
  }

  /**
   * Persists the token and its expiry in settings (localStorage + IndexedDB).
   * Subtracts a 60-second safety buffer from expiresIn.
   */
  private persistToken(token: string, expiresIn: number): void {
    const expiry = Date.now() + Math.max(0, expiresIn - 60) * 1000;
    this._settings.set({ ...this._settings(), accessToken: token, tokenExpiry: expiry });
    this._accessToken.set(token);
    this.saveSettings();
  }

  /** Clears the token from the signal and from persisted settings. */
  private clearToken(): void {
    this._settings.set({ ...this._settings(), accessToken: null, tokenExpiry: null });
    this._accessToken.set(null);
    this.saveSettings();
  }

  /**
   * Attempts a silent token refresh via GIS popup with prompt=''.
   * Only available when not in standalone PWA mode (popup is usable).
   * Returns true if a new token was obtained.
   */
  private async tryRefreshToken(): Promise<boolean> {
    const clientId = this._settings().clientId;
    if (!clientId || this.isStandalonePwa()) return false;
    try {
      await this.loadGsiScript();
      const { token, expiresIn } = await this.requestTokenViaPopup(clientId);
      this.persistToken(token, expiresIn);
      return true;
    } catch {
      this.clearToken();
      return false;
    }
  }

  /** Loads the Google Identity Services script if not already present. */
  private loadGsiScript(): Promise<void> {
    if ((window as any).google?.accounts?.oauth2) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('GSI script failed to load')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  /** Returns true when running as an installed PWA in standalone display mode. */
  private isStandalonePwa(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true // Safari / iOS
    );
  }

  /** Popup flow (browser): opens the Google sign-in popup and resolves with the token and its expiry. */
  private requestTokenViaPopup(clientId: string): Promise<{ token: string; expiresIn: number }> {
    return new Promise((resolve, reject) => {
      const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp: any) => {
          if (resp.error) {
            reject(new Error(`OAuth error: ${resp.error_description ?? resp.error}`));
          } else {
            resolve({
              token: resp.access_token as string,
              expiresIn: Number(resp.expires_in ?? 3599),
            });
          }
        },
        error_callback: (err: any) => {
          reject(new Error(err?.message ?? 'OAuth popup closed'));
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /** Redirect flow (standalone PWA): navigates the page to Google's auth endpoint. */
  private startRedirectFlow(clientId: string): void {
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      ux_mode: 'redirect',
      redirect_uri: this.redirectUri,
      callback: () => {}, // not called during the outbound redirect
    });
    tokenClient.requestAccessToken({ prompt: '' });
    // The browser navigates away; nothing after this line runs.
  }

  /**
   * Ensures that the app's custom write data source exists in Google Fit.
   * Returns the data source ID.
   */
  private async ensureDataSource(token: string): Promise<string> {
    // List existing data sources to find ours
    const listRes = await fetch(`${FITNESS_API}/dataSources?dataTypeName=com.google.weight`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) throw new Error(`Failed to list data sources: ${listRes.status}`);

    const listData = await listRes.json();
    const sources: any[] = listData.dataSource ?? [];
    const existing = sources.find(
      s => s.dataStreamName === 'weight-track' && s.dataType?.name === 'com.google.weight'
    );
    if (existing) return existing.dataStreamId as string;

    // Create a new data source
    const createRes = await fetch(`${FITNESS_API}/dataSources`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dataStreamName: 'weight-track',
        type: 'raw',
        application: { name: 'WeightTrack', version: '1' },
        dataType: { name: 'com.google.weight' },
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Failed to create data source: ${createRes.status}: ${body}`);
    }
    const created = await createRes.json();
    return created.dataStreamId as string;
  }

  private loadSettings(): GoogleFitSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        clientId: parsed.clientId ?? '',
        lastSyncDate: parsed.lastSyncDate ?? null,
        syncedEntryIds: Array.isArray(parsed.syncedEntryIds) ? parsed.syncedEntryIds : [],
        accessToken: parsed.accessToken ?? null,
        tokenExpiry: parsed.tokenExpiry ?? null,
      };
    } catch {
      return { clientId: '', lastSyncDate: null, syncedEntryIds: [], accessToken: null, tokenExpiry: null };
    }
  }

  private saveSettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings()));
    this.db.write(SETTINGS_KEY, this._settings()).catch(() => {});
  }
}
