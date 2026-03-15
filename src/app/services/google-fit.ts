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
const MAX_LOG_ENTRIES = 1000;

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

export interface GfitLogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  context: string;
  message: string;
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class GoogleFitService {
  private readonly db = inject(DbService);
  // _logs must be declared first so it is initialized before any method that calls this.log().
  private readonly _logs = signal<GfitLogEntry[]>([]);
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
  readonly logs = this._logs.asReadonly();

  setClientId(clientId: string): void {
    const updated: GoogleFitSettings = { ...this._settings(), clientId: clientId.trim() };
    this._settings.set(updated);
    this.saveSettings();
  }

  /**
   * The redirect URI used for the OAuth redirect flow (standalone PWA mode).
   * Must be added as an Authorised redirect URI in Google Cloud Console.
   *
   * Points to /oauth.html rather than /sync directly.  On Android the OAuth
   * redirect lands in a Chrome Custom Tab (CCT); /oauth.html reads the token
   * from the URL hash (still intact inside the CCT) and immediately redirects
   * to /sync?access_token=...  Android's intent system preserves query
   * parameters when handing the URL back to the installed PWA, whereas hash
   * fragments are stripped.  This two-step redirect ensures the token reaches
   * the PWA reliably.
   */
  get redirectUri(): string {
    return window.location.origin + '/oauth.html';
  }

  async connect(): Promise<void> {
    this.log('info', 'connect', 'connect() called');

    // If already connected with a valid token, nothing to do.
    if (this._accessToken()) {
      this.log('info', 'connect', 'Already connected — skipping');
      this._status.set('idle');
      this._message.set('Already connected to Google Fit.');
      return;
    }

    const clientId = this._settings().clientId;
    if (!clientId) {
      this.log('warn', 'connect', 'No client ID configured');
      this._status.set('error');
      this._message.set('Enter your Google Client ID first.');
      return;
    }

    this.log('info', 'connect', `Client ID present (length ${clientId.length})`);
    this._status.set('connecting');
    this._message.set('Opening Google sign-in…');

    try {
      await this.loadGsiScript();

      if (this.isStandalonePwa()) {
        // In standalone PWA mode the popup's window.opener is null so GIS cannot
        // post the token back. Use redirect flow instead — the page navigates away
        // and handleRedirectCallback() picks up the token on return.
        //
        // On Android the redirect opens in a Chrome Custom Tab (CCT); on iOS it may
        // open in Safari.  In both cases the redirect context boots a fresh Angular
        // instance that processes the token and then broadcasts it via
        // BroadcastChannel so the standing PWA context can pick it up without
        // relying solely on shared localStorage.
        this.log('info', 'connect', 'Standalone PWA mode detected — using redirect flow');
        try {
          const ch = new BroadcastChannel('gfit-oauth');
          ch.onmessage = ({ data }: MessageEvent<{ accessToken: string; expiresIn: number }>) => {
            ch.close();
            if (data?.accessToken) {
              this.log('info', 'connect', `Token received via BroadcastChannel, expires in ${data.expiresIn}s`);
              this.persistToken(data.accessToken, data.expiresIn);
              this._status.set('idle');
              this._message.set('Connected to Google Fit.');
            } else {
              this.log('warn', 'connect', 'BroadcastChannel message received but no accessToken in payload');
            }
          };
          this.log('info', 'connect', 'BroadcastChannel listener registered on "gfit-oauth"');
        } catch (bcErr) {
          this.log('warn', 'connect', `BroadcastChannel unavailable: ${bcErr instanceof Error ? bcErr.message : String(bcErr)}`);
        }
        this.startRedirectFlow(clientId);
        // Execution stops here; the browser navigates to Google.
      } else {
        this.log('info', 'connect', 'Browser mode — using popup flow');
        const { token, expiresIn } = await this.requestTokenViaPopup(clientId);
        this.log('info', 'connect', `Token obtained via popup, expires in ${expiresIn}s`);
        this.persistToken(token, expiresIn);
        this._status.set('idle');
        this._message.set('Connected to Google Fit.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('error', 'connect', `Connect failed: ${msg}`);
      this.clearToken();
      this._status.set('error');
      this._message.set(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  /**
   * Call this when the Sync page initialises.  If the user just returned from
   * the Google OAuth redirect (token or error is in the URL), this method will
   * process the response and update the service state accordingly.
   *
   * @param fromVisibilityChange Pass `true` when calling from a `visibilitychange`
   *   handler (i.e. the app returned to the foreground).  In that case a missing
   *   token in the URL is not treated as an error — the token may arrive via the
   *   BroadcastChannel listener set up in `connect()`, or via `refreshFromStorage()`.
   */
  async handleRedirectCallback(fromVisibilityChange = false): Promise<void> {
    const hash = window.location.hash;
    const search = window.location.search;

    const sanitizedHash = hash.replace(/access_token=[^&]+/, 'access_token=[REDACTED]');
    const sanitizedSearch = search.replace(/access_token=[^&]+/, 'access_token=[REDACTED]');
    this.log('info', 'oauth-cb', `handleRedirectCallback() — fromVisibilityChange: ${fromVisibilityChange}`, `hash: "${sanitizedHash}" search: "${sanitizedSearch}"`);

    // Parse both sources: hash (direct PWA navigation) and search params
    // (via /oauth.html bridge, which converts the hash to query params so the
    // token survives Android's intent-based handoff to the installed PWA).
    const hashParams = new URLSearchParams(hash.substring(1)); // strip leading '#'
    const searchParams = new URLSearchParams(search.substring(1)); // strip leading '?'

    // Google returns errors either as a hash fragment or query parameter.
    const errorMatch = hash.match(/[#&]error=([^&]+)/) ?? search.match(/[?&]error=([^&]+)/);
    if (errorMatch) {
      const errorCode = decodeURIComponent(errorMatch[1]);
      this.log('warn', 'oauth-cb', `OAuth error in URL: ${errorCode}`);
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

    const hasToken = hash.includes('access_token') || search.includes('access_token');
    if (!hasToken) {
      this.log('info', 'oauth-cb', 'No access_token or error in URL');
      if (this._status() === 'connecting') {
        if (fromVisibilityChange) {
          // Returned to foreground with no OAuth data in the URL.  The redirect
          // was likely handled in an Android CCT or iOS Safari context.  Reset to
          // idle so the Connect button becomes active again; the BroadcastChannel
          // listener (set up in connect()) will update state if the token arrives.
          this.log('info', 'oauth-cb', 'fromVisibilityChange=true — resetting status to idle, awaiting BroadcastChannel');
          this._status.set('idle');
          this._message.set('');
        } else {
          // App restarted after a redirect that carried no token — genuine failure.
          this.log('error', 'oauth-cb', 'Status was "connecting" but no token in URL — treating as failure');
          this._status.set('error');
          this._message.set('Sign-in did not complete. Please try connecting again.');
        }
      }
      return;
    }

    const clientId = this._settings().clientId;
    if (!clientId) {
      this.log('warn', 'oauth-cb', 'access_token found in URL but no client ID configured — ignoring');
      return;
    }

    // Prefer hash (direct navigation); fall back to search params (via /oauth.html bridge).
    const token = hashParams.get('access_token') ?? searchParams.get('access_token');
    const expiresIn = Number(
      hashParams.get('expires_in') ?? searchParams.get('expires_in') ?? '3599'
    );
    if (token) {
      this.log('info', 'oauth-cb', `Token found in URL hash — expires_in: ${expiresIn}s`);
      this.persistToken(token, expiresIn);
      this._status.set('idle');
      this._message.set('Connected to Google Fit.');
      // Remove the fragment so a page refresh doesn't re-process it.
      history.replaceState(null, '', window.location.pathname);
      // Relay the token to any standing PWA context via BroadcastChannel
      // (handles Android CCT → TWA and iOS Safari → standalone app scenarios).
      try {
        const ch = new BroadcastChannel('gfit-oauth');
        ch.postMessage({ accessToken: token, expiresIn });
        ch.close();
        this.log('info', 'oauth-cb', 'Token relayed via BroadcastChannel "gfit-oauth"');
      } catch (bcErr) {
        this.log('warn', 'oauth-cb', `BroadcastChannel relay failed: ${bcErr instanceof Error ? bcErr.message : String(bcErr)}`);
      }
    } else {
      this.log('warn', 'oauth-cb', 'access_token key present in hash but value is null');
    }
  }

  disconnect(): void {
    this.log('info', 'disconnect', 'disconnect() called');
    const token = this._accessToken();
    if (token && (window as any).google?.accounts?.oauth2) {
      this.log('info', 'disconnect', 'Revoking token via Google OAuth2 API');
      (window as any).google.accounts.oauth2.revoke(token, () => {});
    } else {
      this.log('info', 'disconnect', 'No token to revoke or Google OAuth2 API unavailable');
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
    this.log('info', 'storage', 'refreshFromStorage() called');
    const fresh = this.loadSettings();
    this._settings.set(fresh);
    const { accessToken, tokenExpiry } = fresh;
    const hasValidToken = !!(accessToken && tokenExpiry && Date.now() < tokenExpiry);
    if (hasValidToken && !this._accessToken()) {
      this.log('info', 'storage', `Valid token found in localStorage, expires at ${new Date(tokenExpiry!).toISOString()}`);
      this._accessToken.set(accessToken!);
      this._status.set('idle');
      this._message.set('Connected to Google Fit.');
      return true;
    }
    if (!hasValidToken) {
      this.log('info', 'storage', accessToken ? 'Token in localStorage is expired or missing expiry' : 'No token in localStorage');
    } else {
      this.log('info', 'storage', 'Token already applied to state, no update needed');
    }
    return false;
  }

  /**
   * Pull weight entries from Google Fit and merge them into the app.
   * Calls `addEntry` for each new data point (WeightService.addEntry handles dedup by date).
   * Returns the number of entries imported.
   */
  async importFromGoogleFit(addEntry: (e: Omit<WeightEntry, 'id'>) => void): Promise<number> {
    this.log('info', 'import', 'importFromGoogleFit() called');
    const token = this._accessToken();
    if (!token) {
      this.log('warn', 'import', 'Aborted — not connected');
      this._message.set('Not connected.');
      return 0;
    }

    this._status.set('syncing');
    this._message.set('Fetching weight data from Google Fit…');

    try {
      const endMs = Date.now();
      const startMs = endMs - 365 * 24 * 60 * 60 * 1000; // last 12 months
      const startNs = String(startMs * 1_000_000);
      const endNs = String(endMs * 1_000_000);

      const url = `${FITNESS_API}/dataSources/${MERGED_SOURCE}/datasets/${startNs}-${endNs}`;
      this.log('info', 'import', `Date range: ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);
      this.log('info', 'import', `GET ${url}`);

      let res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      this.log(res.ok ? 'info' : 'warn', 'import', `API response: ${res.status} ${res.statusText}`);

      // If the token expired mid-session, attempt a silent refresh and retry once.
      if (res.status === 401) {
        this.log('warn', 'import', '401 received — attempting silent token refresh');
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          this.log('info', 'import', 'Token refresh succeeded — retrying request');
          res = await fetch(url, {
            headers: { Authorization: `Bearer ${this._accessToken()!}` },
          });
          this.log(res.ok ? 'info' : 'warn', 'import', `Retry response: ${res.status} ${res.statusText}`);
        } else {
          this.log('warn', 'import', 'Token refresh failed — aborting import');
        }
      }

      if (!res.ok) {
        const body = await res.text();
        this.log('error', 'import', `API error ${res.status}`, body.substring(0, 500));
        throw new Error(`Google Fit API error ${res.status}: ${body}`);
      }

      const data = await res.json();
      const points: any[] = data.point ?? [];
      this.log('info', 'import', `${points.length} data point(s) received from Google Fit`);
      let count = 0;

      for (const point of points) {
        const weightKg: number | undefined = point.value?.[0]?.fpVal;
        const startTimeNs: string | undefined = point.startTimeNanos;
        if (weightKg == null || !startTimeNs) {
          this.log('warn', 'import', 'Skipping data point — missing fpVal or startTimeNanos', JSON.stringify(point));
          continue;
        }

        const dateMs = Math.round(Number(startTimeNs) / 1_000_000);
        const date = new Date(dateMs).toISOString().split('T')[0];
        const weight = Math.round(weightKg * 10) / 10;

        addEntry({ date, weight });
        count++;
      }

      this.log('info', 'import', `Import complete — ${count} new/updated entries added (${points.length - count} skipped)`);
      const synced = new Date().toISOString();
      this._settings.set({ ...this._settings(), lastSyncDate: synced });
      this.saveSettings();

      this._importedCount.set(count);
      this._status.set('success');
      this._message.set(`Imported ${count} entr${count === 1 ? 'y' : 'ies'} from Google Fit.`);
      return count;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('error', 'import', `Import failed: ${msg}`);
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
    this.log('info', 'auto-sync', `syncEntry() — entry ${entry.id} (${entry.date}, ${entry.weight} kg)`);
    const token = this._accessToken();
    if (!token) {
      this.log('info', 'auto-sync', 'Skipped — not connected');
      return;
    }

    const settings = this._settings();
    if (settings.syncedEntryIds.includes(entry.id)) {
      this.log('info', 'auto-sync', `Skipped — entry ${entry.id} already synced`);
      return;
    }

    try {
      const dataSourceId = await this.ensureDataSource(token);
      this.log('info', 'auto-sync', `Using data source: ${dataSourceId}`);
      const ms = new Date(entry.date).getTime();
      const ns = String(ms * 1_000_000);

      const patchUrl = `${FITNESS_API}/dataSources/${encodeURIComponent(dataSourceId)}/datasets/${ns}-${ns}`;
      this.log('info', 'auto-sync', `PATCH ${patchUrl}`);
      const patchRes = await fetch(patchUrl, {
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
      });

      if (!patchRes.ok) {
        this.log('warn', 'auto-sync', `PATCH failed — status ${patchRes.status} — entry will not be marked as synced`);
        return; // silent failure — user can manually export later
      }

      this.log('info', 'auto-sync', `PATCH response: ${patchRes.status} — entry ${entry.id} synced successfully`);
      const updatedIds = [...this._settings().syncedEntryIds, entry.id];
      this._settings.set({ ...this._settings(), syncedEntryIds: updatedIds });
      this.saveSettings();
    } catch (err: unknown) {
      // Silent failure for background auto-sync
      this.log('error', 'auto-sync', `Auto-sync error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Push all local weight entries to Google Fit.
   * Creates a custom data source on first run, then patches the dataset.
   * Returns the number of entries exported.
   */
  async exportToGoogleFit(entries: WeightEntry[]): Promise<number> {
    this.log('info', 'export', `exportToGoogleFit() called — ${entries.length} entries`);
    const token = this._accessToken();
    if (!token) {
      this.log('warn', 'export', 'Aborted — not connected');
      this._message.set('Not connected.');
      return 0;
    }
    if (entries.length === 0) {
      this.log('warn', 'export', 'Aborted — no entries to export');
      this._message.set('No entries to export.');
      return 0;
    }

    this._status.set('syncing');
    this._message.set('Pushing entries to Google Fit…');

    try {
      const dataSourceId = await this.ensureDataSource(token);
      this.log('info', 'export', `Using data source: ${dataSourceId}`);

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
      this.log('info', 'export', `PATCH ${patchUrl}`);
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
      this.log(patchRes.ok ? 'info' : 'error', 'export', `PATCH response: ${patchRes.status} ${patchRes.statusText}`);

      if (!patchRes.ok) {
        const body = await patchRes.text();
        this.log('error', 'export', `Export API error body`, body.substring(0, 500));
        throw new Error(`Export error ${patchRes.status}: ${body}`);
      }

      const synced = new Date().toISOString();
      const allIds = entries.map(e => e.id);
      this._settings.set({ ...this._settings(), lastSyncDate: synced, syncedEntryIds: allIds });
      this.saveSettings();

      const count = entries.length;
      this.log('info', 'export', `Export complete — ${count} entries pushed`);
      this._exportedCount.set(count);
      this._status.set('success');
      this._message.set(`Exported ${count} entr${count === 1 ? 'y' : 'ies'} to Google Fit.`);
      return count;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('error', 'export', `Export failed: ${msg}`);
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
    if (localStorage.getItem(SETTINGS_KEY)) {
      this.log('info', 'init', 'restoreFromDb() — settings already in localStorage, skipping IndexedDB restore');
      return;
    }
    this.log('info', 'init', 'restoreFromDb() — localStorage empty, checking IndexedDB');
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
      if (valid) {
        this._accessToken.set(valid);
        this.log('info', 'init', `Settings restored from IndexedDB — valid token recovered, expires at ${new Date(restored.tokenExpiry!).toISOString()}`);
      } else {
        this.log('info', 'init', 'Settings restored from IndexedDB — token expired or absent');
      }
    } else {
      this.log('info', 'init', 'restoreFromDb() — no settings found in IndexedDB');
    }
  }

  /**
   * Triggers a browser download of all current log entries as a JSON file.
   */
  downloadLogs(): void {
    const logs = this._logs();
    const payload = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      origin: window.location.origin,
      isStandalonePwa: this.isStandalonePwa(),
      isConnected: this.isConnected(),
      lastSyncDate: this._settings().lastSyncDate,
      tokenExpiry: this._settings().tokenExpiry
        ? new Date(this._settings().tokenExpiry!).toISOString()
        : null,
      logCount: logs.length,
      logs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gfit-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.log('info', 'export-logs', `Debug log file downloaded (${logs.length} entries)`);
  }

  /** Clears all in-memory log entries. */
  clearLogs(): void {
    this._logs.set([]);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Appends a structured log entry, capped at MAX_LOG_ENTRIES. */
  private log(level: GfitLogEntry['level'], context: string, message: string, detail?: string): void {
    const entry: GfitLogEntry = { ts: new Date().toISOString(), level, context, message, ...(detail !== undefined ? { detail } : {}) };
    const current = this._logs();
    const next = current.length >= MAX_LOG_ENTRIES
      ? [...current.slice(-(MAX_LOG_ENTRIES - 1)), entry]
      : [...current, entry];
    this._logs.set(next);
  }

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
    this.log('info', 'token', `Token persisted — expires at ${new Date(expiry).toISOString()} (in ${Math.round((expiry - Date.now()) / 1000)}s)`);
    this._settings.set({ ...this._settings(), accessToken: token, tokenExpiry: expiry });
    this._accessToken.set(token);
    this.saveSettings();
  }

  /** Clears the token from the signal and from persisted settings. */
  private clearToken(): void {
    this.log('info', 'token', 'Token cleared from state and storage');
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
    if (!clientId || this.isStandalonePwa()) {
      this.log('warn', 'token', `Silent refresh skipped — ${!clientId ? 'no client ID' : 'standalone PWA mode'}`);
      return false;
    }
    this.log('info', 'token', 'Attempting silent token refresh via popup');
    try {
      await this.loadGsiScript();
      const { token, expiresIn } = await this.requestTokenViaPopup(clientId);
      this.persistToken(token, expiresIn);
      this.log('info', 'token', `Silent refresh succeeded, expires in ${expiresIn}s`);
      return true;
    } catch (err: unknown) {
      this.log('warn', 'token', `Silent refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      this.clearToken();
      return false;
    }
  }

  /** Loads the Google Identity Services script if not already present. */
  private loadGsiScript(): Promise<void> {
    if ((window as any).google?.accounts?.oauth2) {
      this.log('info', 'gsi', 'google.accounts.oauth2 already present — skipping script load');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (existing) {
        this.log('info', 'gsi', 'GSI script already in DOM — awaiting load event');
        existing.addEventListener('load', () => {
          this.log('info', 'gsi', 'GSI script (pre-existing) loaded');
          resolve();
        });
        existing.addEventListener('error', () => {
          this.log('error', 'gsi', 'GSI script (pre-existing) failed to load');
          reject(new Error('GSI script failed to load'));
        });
        return;
      }
      this.log('info', 'gsi', 'Injecting GSI script into <head>');
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        this.log('info', 'gsi', 'GSI script loaded successfully');
        resolve();
      };
      script.onerror = () => {
        this.log('error', 'gsi', 'GSI script failed to load — check network and CSP');
        reject(new Error('Failed to load Google Identity Services'));
      };
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
    this.log('info', 'oauth', 'Requesting token via GIS popup');
    return new Promise((resolve, reject) => {
      const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp: any) => {
          if (resp.error) {
            this.log('error', 'oauth', `Popup OAuth error: ${resp.error}`, resp.error_description ?? '');
            reject(new Error(`OAuth error: ${resp.error_description ?? resp.error}`));
          } else {
            const expiresIn = Number(resp.expires_in ?? 3599);
            this.log('info', 'oauth', `Popup OAuth success — token received, expires_in: ${expiresIn}s`);
            resolve({
              token: resp.access_token as string,
              expiresIn,
            });
          }
        },
        error_callback: (err: any) => {
          this.log('error', 'oauth', `Popup error_callback: ${err?.message ?? 'unknown'}`, JSON.stringify(err));
          reject(new Error(err?.message ?? 'OAuth popup closed'));
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /** Redirect flow (standalone PWA): navigates the page to Google's auth endpoint. */
  private startRedirectFlow(clientId: string): void {
    this.log('info', 'oauth', `Starting redirect flow — redirect_uri: ${this.redirectUri}`);
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
    const listUrl = `${FITNESS_API}/dataSources?dataTypeName=com.google.weight`;
    this.log('info', 'datasource', `Listing data sources — GET ${listUrl}`);
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.log(listRes.ok ? 'info' : 'error', 'datasource', `List response: ${listRes.status} ${listRes.statusText}`);
    if (!listRes.ok) throw new Error(`Failed to list data sources: ${listRes.status}`);

    const listData = await listRes.json();
    const sources: any[] = listData.dataSource ?? [];
    this.log('info', 'datasource', `${sources.length} data source(s) found`, sources.map(s => s.dataStreamId).join(', '));

    const existing = sources.find(
      s => s.dataStreamName === 'weight-track' && s.dataType?.name === 'com.google.weight'
    );
    if (existing) {
      this.log('info', 'datasource', `Reusing existing weight-track source: ${existing.dataStreamId}`);
      return existing.dataStreamId as string;
    }

    // Create a new data source
    this.log('info', 'datasource', 'No weight-track source found — creating new data source');
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
    this.log(createRes.ok ? 'info' : 'error', 'datasource', `Create response: ${createRes.status} ${createRes.statusText}`);
    if (!createRes.ok) {
      const body = await createRes.text();
      this.log('error', 'datasource', `Create data source error body`, body.substring(0, 500));
      throw new Error(`Failed to create data source: ${createRes.status}: ${body}`);
    }
    const created = await createRes.json();
    this.log('info', 'datasource', `Data source created: ${created.dataStreamId}`);
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
