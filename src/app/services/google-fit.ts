import { Injectable, signal, computed, inject } from '@angular/core';
import { WeightEntry } from '../models/weight-entry';
import { BloodPressureEntry } from '../models/blood-pressure-entry';
import { DbService } from '../db';

export type GoogleFitStatus = 'idle' | 'connecting' | 'syncing' | 'success' | 'error';

const SETTINGS_KEY = 'weight_google_fit';
const FITNESS_API = 'https://www.googleapis.com/fitness/v1/users/me';
// Merged weight data source provided by Google Fit (read-only, all apps contribute)
const MERGED_SOURCE = 'derived:com.google.weight:com.google.android.gms:merge_weight';
// Required OAuth scopes for reading and writing body and blood pressure data
const SCOPES = 'https://www.googleapis.com/auth/fitness.body.read https://www.googleapis.com/auth/fitness.body.write https://www.googleapis.com/auth/fitness.blood_pressure.read https://www.googleapis.com/auth/fitness.blood_pressure.write';
const MAX_LOG_ENTRIES = 1000;

export interface GoogleFitSettings {
  clientId: string;
  /**
   * OAuth Client Secret for "Web application" type clients.
   * Google requires this in the PKCE token exchange for web application clients
   * (unlike native/desktop clients). Leave empty only if using a Desktop app
   * client type.
   */
  clientSecret: string;
  lastSyncDate: string | null;
  /** IDs of WeightEntry records already written to Google Fit — prevents duplicate writes. */
  syncedEntryIds: string[];
  /** IDs of BloodPressureEntry records already written to Google Fit — prevents duplicate writes. */
  syncedBpEntryIds: string[];
  /** Persisted OAuth access token. Null when disconnected or cleared by disconnect(). */
  accessToken: string | null;
  /** Unix timestamp in ms after which accessToken is considered expired. */
  tokenExpiry: number | null;
  /**
   * OAuth refresh token obtained when access_type=offline is requested.
   * Used to silently obtain a new access token without user interaction.
   * Null when not yet obtained or after disconnect.
   */
  refreshToken: string | null;
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
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Updated every 60 seconds so time-based computed signals (connectedLabel) stay current. */
  private readonly _clockTick = signal<number>(Date.now());

  readonly settings = this._settings.asReadonly();
  readonly isConnected = computed(() => this._accessToken() !== null);
  readonly status = this._status.asReadonly();
  readonly message = this._message.asReadonly();
  readonly importedCount = this._importedCount.asReadonly();
  readonly exportedCount = this._exportedCount.asReadonly();
  readonly logs = this._logs.asReadonly();
  readonly connectedLabel = computed(() => this.formatConnectedLabel(this._settings().tokenExpiry, this._clockTick()));

  constructor() {
    // If a valid token was restored from localStorage at startup, schedule its refresh.
    const expiry = this._settings().tokenExpiry;
    if (this._accessToken() && expiry) {
      this.scheduleRefresh(expiry);
    }
    // Tick every 60 seconds so connectedLabel stays accurate as time passes.
    setInterval(() => this._clockTick.set(Date.now()), 60_000);
  }

  setClientId(clientId: string): void {
    const updated: GoogleFitSettings = { ...this._settings(), clientId: clientId.trim() };
    this._settings.set(updated);
    this.saveSettings();
  }

  setClientSecret(clientSecret: string): void {
    const updated: GoogleFitSettings = { ...this._settings(), clientSecret: clientSecret.trim() };
    this._settings.set(updated);
    this.saveSettings();
  }

  /**
   * The redirect URI used for the PKCE OAuth flow (standalone PWA mode).
   * Must be added as an Authorised redirect URI in Google Cloud Console.
   *
   * Points directly to /sync.  When Google completes authentication it redirects
   * to /sync?code=...&state=...  Android's intent system intercepts this URL
   * (it is within the PWA's scope), closes the Chrome Custom Tab, and navigates
   * the WebAPK WebView to /sync?code=... — the authorization code arrives in the
   * URL query string, which survives Android intent routing unlike hash fragments.
   * The PWA then exchanges the code for a token locally using the stored PKCE
   * code_verifier.  No cross-context storage (localStorage / BroadcastChannel)
   * is required, bypassing Chrome's storage partitioning entirely.
   */
  get redirectUri(): string {
    return window.location.origin + '/sync';
  }

  async connect(): Promise<void> {
    this.log('info', 'connect', 'connect() called');
    this.logEnvironment('connect');

    // If already connected with a valid token, nothing to do.
    if (this._accessToken()) {
      const expiry = this._settings().tokenExpiry;
      const remainingSec = expiry ? Math.round((expiry - Date.now()) / 1000) : null;
      this.log('info', 'connect', 'Already connected — skipping',
        `Expected: valid token in memory. Actual: token present, expires in ${remainingSec != null ? remainingSec + 's' : 'unknown'}`);
      this._status.set('idle');
      this._message.set('Already connected to Google Fit.');
      return;
    }

    const clientId = this._settings().clientId;
    if (!clientId) {
      this.log('warn', 'connect', 'No client ID configured',
        'Expected: clientId set in settings. Actual: empty string. User must paste their OAuth Client ID before connecting.');
      this._status.set('error');
      this._message.set('Enter your Google Client ID first.');
      return;
    }

    // Validate client ID format (should end with .apps.googleusercontent.com)
    const clientIdValid = clientId.includes('.apps.googleusercontent.com');
    this.log('info', 'connect',
      `Client ID present — length: ${clientId.length}, format-valid: ${clientIdValid}`,
      clientIdValid
        ? `Expected format: <project>.apps.googleusercontent.com — OK`
        : `Expected format: <project>.apps.googleusercontent.com — MISMATCH (got: "${clientId.slice(0, 20)}…"). Wrong client ID type? Make sure you created a Web OAuth 2.0 Client ID, not Android/iOS.`
    );

    // Check localStorage availability before attempting OAuth
    const lsAvailable = this.checkLocalStorage();
    this.log(lsAvailable ? 'info' : 'warn', 'connect',
      `localStorage availability: ${lsAvailable}`,
      lsAvailable
        ? 'Expected: localStorage writable for token persistence — OK'
        : 'Expected: localStorage writable for token persistence — UNAVAILABLE. Token will not persist across page loads.'
    );

    // Check BroadcastChannel availability (needed for Android CCT → PWA handoff)
    const bcAvailable = typeof BroadcastChannel !== 'undefined';
    this.log(bcAvailable ? 'info' : 'warn', 'connect',
      `BroadcastChannel availability: ${bcAvailable}`,
      bcAvailable
        ? 'Expected: BroadcastChannel supported for Android CCT token relay — OK'
        : 'Expected: BroadcastChannel supported — UNAVAILABLE. Android PWA token relay may fail; only localStorage fallback will work.'
    );

    this._status.set('connecting');
    this._message.set('Opening Google sign-in…');

    try {
      const standalone = this.isStandalonePwa();
      this.log('info', 'connect',
        `Flow selection — isStandalonePwa: ${standalone}`,
        standalone
          ? 'Expected flow: PKCE Authorization Code (no GIS library needed). PWA navigates to Google, returns via /sync?code=...'
          : 'Expected flow: GIS popup (window.opener available in browser tab). Token returned directly to callback.'
      );

      if (standalone) {
        // PKCE Authorization Code Flow for standalone PWA mode.
        //
        // Previous approaches (GIS redirect + /oauth.html bridge) failed because
        // Chrome 115+ applies storage partitioning: the Chrome Custom Tab (CCT)
        // that handled the redirect ran in a separate storage context, so any
        // localStorage writes or BroadcastChannel messages from the CCT were
        // invisible to the PWA.
        //
        // PKCE fix: Google redirects to /sync?code=...&state=... (query params,
        // not a hash fragment).  Android's intent system intercepts this in-scope
        // URL, closes the CCT, and navigates the WebAPK WebView to the new URL.
        // The PWA reads ?code= from window.location.search — no cross-context
        // storage involved — and exchanges it for a token via Google's token
        // endpoint using the locally-stored PKCE code_verifier.
        this.log('info', 'connect', 'Standalone PWA — starting PKCE Authorization Code flow',
          `redirect_uri: "${this.redirectUri}" must be registered in Cloud Console → Credentials → Authorised redirect URIs.`);
        await this.startPkceFlow(clientId);
        // window.location.href was set inside startPkceFlow(); execution stops here.
      } else {
        this.log('info', 'connect', 'Browser mode — requesting token via GIS popup',
          'Expected: popup window opens at accounts.google.com. User signs in. Callback receives access_token.');
        await this.loadGsiScript();
        const { token, expiresIn } = await this.requestTokenViaPopup(clientId);
        this.log('info', 'connect',
          `Token obtained via popup — length: ${token.length}, expires_in: ${expiresIn}s`,
          `Expected: access_token string (typically 200+ chars) with expires_in ~3599. Actual: length=${token.length}, expires_in=${expiresIn}s. ${expiresIn < 60 ? 'WARNING: expires_in is unusually short' : 'OK'}`
        );
        this.persistToken(token, expiresIn);
        this._status.set('idle');
        this._message.set('Connected to Google Fit.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('error', 'connect', `Connect failed: ${msg}`,
        `Expected: OAuth flow to complete and return a token. Actual error: "${msg}". ` +
        `Common causes: popup blocked (check browser popup settings), access_denied (add test user in Cloud Console), ` +
        `invalid_client (wrong client ID or missing Authorised origin ${window.location.origin}), ` +
        `GSI script load failure (check network / CSP).`
      );
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
    this.log('info', 'oauth-cb',
      `handleRedirectCallback() — fromVisibilityChange: ${fromVisibilityChange}`,
      `URL: pathname="${window.location.pathname}" hash(${hash.length} chars)="${sanitizedHash}" search(${search.length} chars)="${sanitizedSearch}" currentStatus="${this._status()}"`
    );

    // Log all keys present in both hash and search params for diagnosis
    const hashParams = new URLSearchParams(hash.substring(1));
    const searchParams = new URLSearchParams(search.substring(1));
    const hashKeys = [...hashParams.keys()];
    const searchKeys = [...searchParams.keys()];
    this.log('info', 'oauth-cb',
      `URL param keys — hash: [${hashKeys.join(', ') || 'none'}] — search: [${searchKeys.join(', ') || 'none'}]`,
      `Expected after successful Google redirect: hash should contain [access_token, token_type, expires_in, scope] OR search should contain [access_token, expires_in] (via /oauth.html bridge). ` +
      `Expected after user denial: hash/search should contain [error=access_denied]. ` +
      `If no params: page loaded normally (not a redirect callback).`
    );

    // Google returns errors either as a hash fragment or query parameter.
    const errorMatch = hash.match(/[#&]error=([^&]+)/) ?? search.match(/[?&]error=([^&]+)/);
    if (errorMatch) {
      const errorCode = decodeURIComponent(errorMatch[1]);
      const errorDesc = hashParams.get('error_description') ?? searchParams.get('error_description') ?? '(no description)';
      this.log('warn', 'oauth-cb',
        `OAuth error returned by Google: "${errorCode}"`,
        `error_description: "${errorDesc}". ` +
        (errorCode === 'access_denied'
          ? 'Expected: user grants consent. Actual: user denied OR app not verified. Fix: add your Google account as a Test User in Cloud Console → APIs & Services → OAuth consent screen → Test users.'
          : errorCode === 'invalid_client'
          ? 'Expected: valid client_id matching an authorised origin. Actual: client_id rejected by Google. Check the client ID in settings and confirm this origin is listed under Authorised JavaScript origins in Cloud Console.'
          : errorCode === 'redirect_uri_mismatch'
          ? `Expected: redirect_uri "${this.redirectUri}" is listed in Cloud Console Authorised redirect URIs. Actual: mismatch. Add "${this.redirectUri}" to Authorised redirect URIs.`
          : `See https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors for details on error code "${errorCode}".`)
      );
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

    // PKCE Authorization Code Flow: ?code= arrives as a query parameter.
    // Detected before implicit-flow access_token check.
    const code = searchParams.get('code');
    if (code) {
      const state = searchParams.get('state') ?? '';
      this.log('info', 'oauth-cb',
        `PKCE authorization code detected — length: ${code.length}, state length: ${state.length}`,
        `Expected: code exchanged for access token via POST /token with stored code_verifier. Cleaning URL.`
      );
      history.replaceState(null, '', window.location.pathname);
      await this.exchangeCodeForToken(code, state);
      return;
    }

    const hasTokenInHash = hash.includes('access_token');
    const hasTokenInSearch = search.includes('access_token');
    const hasToken = hasTokenInHash || hasTokenInSearch;
    this.log('info', 'oauth-cb',
      `Token presence — in hash: ${hasTokenInHash}, in search: ${hasTokenInSearch}`,
      hasToken
        ? `Token found — will extract from ${hasTokenInHash ? 'hash (direct Google redirect)' : 'search params (via /oauth.html bridge)'}`
        : `No token found — ${fromVisibilityChange ? 'returned from background (expected when CCT handled the redirect)' : 'no redirect callback in progress'}`
    );

    if (!hasToken) {
      if (this._status() === 'connecting') {
        if (fromVisibilityChange) {
          // Returned to foreground with no OAuth data in the URL.  The redirect
          // was likely handled in an Android CCT or iOS Safari context.  Reset to
          // idle so the Connect button becomes active again; the BroadcastChannel
          // listener (set up in connect()) will update state if the token arrives.
          this.log('info', 'oauth-cb',
            'fromVisibilityChange=true with status="connecting" — resetting to idle, awaiting BroadcastChannel or refreshFromStorage()',
            'Expected: token will arrive via BroadcastChannel from /oauth.html, or via refreshFromStorage() 500ms retry. If neither fires, the CCT may have been blocked or the redirect_uri is not registered.'
          );
          this._status.set('idle');
          this._message.set('');
        } else {
          // App restarted after a redirect that carried no token — genuine failure.
          this.log('error', 'oauth-cb',
            'Status was "connecting" but no token in URL on fresh page load — treating as failure',
            'Expected: access_token in URL hash after Google redirected back. Actual: URL has no OAuth params. Possible causes: (1) redirect_uri not registered in Cloud Console, (2) Google redirected to a different URL than /sync, (3) browser stripped the hash fragment before Angular loaded.'
          );
          this._status.set('error');
          this._message.set('Sign-in did not complete. Please try connecting again.');
        }
      } else {
        this.log('info', 'oauth-cb',
          `No token in URL and status is "${this._status()}" — nothing to do`,
          'Normal page load or navigation — not a redirect callback.'
        );
      }
      return;
    }

    const clientId = this._settings().clientId;
    if (!clientId) {
      this.log('warn', 'oauth-cb',
        'access_token found in URL but no client ID configured — ignoring',
        'Expected: client ID already saved before OAuth flow started. Actual: clientId is empty. The token cannot be validated without a client ID. This should not happen in normal flows.'
      );
      return;
    }

    // Prefer hash (direct navigation); fall back to search params (via /oauth.html bridge).
    const tokenSource = hasTokenInHash ? 'hash' : 'search';
    const token = hashParams.get('access_token') ?? searchParams.get('access_token');
    const expiresIn = Number(
      hashParams.get('expires_in') ?? searchParams.get('expires_in') ?? '3599'
    );
    const tokenType = hashParams.get('token_type') ?? searchParams.get('token_type') ?? '(not present)';
    const scope = hashParams.get('scope') ?? searchParams.get('scope') ?? '(not present)';

    if (token) {
      const scopeOk = scope.includes('fitness.body');
      this.log('info', 'oauth-cb',
        `Token extracted from ${tokenSource} — length: ${token.length}, expires_in: ${expiresIn}s, token_type: ${tokenType}`,
        `scope: "${scope}". ` +
        (scopeOk
          ? 'Expected scope contains fitness.body — OK'
          : `Expected scope to include "fitness.body.read" and "fitness.body.write". Actual: "${scope}". The app may lack permission to read/write weight data.`) +
        ` | expires_in expected ~3599, actual ${expiresIn}${expiresIn < 60 ? ' — WARNING: unusually short expiry' : ' — OK'}`
      );
      this.persistToken(token, expiresIn);
      this._status.set('idle');
      this._message.set('Connected to Google Fit.');
      // Remove the fragment so a page refresh doesn't re-process it.
      history.replaceState(null, '', window.location.pathname);
      this.log('info', 'oauth-cb', 'URL hash/search cleared via history.replaceState',
        'Expected: URL is now clean (no access_token). A page refresh will not re-process this token.');
      // Relay the token to any standing PWA context via BroadcastChannel
      // (handles Android CCT → TWA and iOS Safari → standalone app scenarios).
      try {
        const ch = new BroadcastChannel('gfit-oauth');
        ch.postMessage({ accessToken: token, expiresIn });
        ch.close();
        this.log('info', 'oauth-cb',
          'Token relayed via BroadcastChannel "gfit-oauth"',
          'Expected: standing PWA context (if any) receives token via ch.onmessage and calls persistToken().'
        );
      } catch (bcErr) {
        this.log('warn', 'oauth-cb',
          `BroadcastChannel relay failed: ${bcErr instanceof Error ? bcErr.message : String(bcErr)}`,
          'Expected: BroadcastChannel to relay token to standing PWA context. Actual: relay failed. The standing PWA will rely on refreshFromStorage() instead.'
        );
      }
    } else {
      this.log('warn', 'oauth-cb',
        'access_token key present in URL but value is null/empty',
        `Expected: access_token=[non-empty string]. Actual: access_token key exists in ${tokenSource} but the value is null or empty. This may indicate a malformed redirect from /oauth.html or an unexpected Google response.`
      );
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
    this.clearRefreshToken();
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
    this.log('info', 'storage', 'refreshFromStorage() called',
      'Expected: read fresh settings from localStorage; apply token if valid and not already in memory. Called after Android CCT closes and PWA comes to foreground.');
    const fresh = this.loadSettings();
    this._settings.set(fresh);
    const { accessToken, tokenExpiry } = fresh;
    const now = Date.now();
    const hasToken = !!accessToken;
    const hasExpiry = !!tokenExpiry;
    const notExpired = hasExpiry && now < tokenExpiry!;
    const hasValidToken = hasToken && hasExpiry && notExpired;
    this.log('info', 'storage',
      `localStorage token state — hasToken: ${hasToken}, hasExpiry: ${hasExpiry}, notExpired: ${notExpired} → hasValidToken: ${hasValidToken}`,
      hasToken && hasExpiry
        ? `Token length: ${accessToken!.length}. Expiry: ${new Date(tokenExpiry!).toISOString()}. Now: ${new Date(now).toISOString()}. ` +
          (notExpired ? `Valid for ${Math.round((tokenExpiry! - now) / 1000)}s more.` : `EXPIRED ${Math.round((now - tokenExpiry!) / 1000)}s ago.`)
        : hasToken
        ? 'Token present but tokenExpiry is null — token cannot be validated, treating as expired.'
        : 'No access token in localStorage. If the CCT wrote the token, it may not have persisted (e.g. storage partitioned or /oauth.html script blocked).'
    );
    if (hasValidToken && !this._accessToken()) {
      this.log('info', 'storage',
        `Applying localStorage token to in-memory state — expires at ${new Date(tokenExpiry!).toISOString()}`,
        `Expected: isConnected() becomes true. This handles the Android CCT scenario where /oauth.html wrote the token to localStorage before redirecting back to /sync.`
      );
      this._accessToken.set(accessToken!);
      this._status.set('idle');
      this._message.set('Connected to Google Fit.');
      return true;
    }
    if (!hasValidToken) {
      this.log('info', 'storage',
        accessToken ? 'Token in localStorage is expired or missing expiry — not applying' : 'No token in localStorage — nothing to restore',
        !hasToken
          ? 'If you just completed the OAuth flow on Android: the CCT may have been blocked from writing to localStorage (storage partitioning). Check oauth.html console errors.'
          : !hasExpiry
          ? 'tokenExpiry field is missing from stored settings. This may indicate a corrupted settings object.'
          : `Token expired at ${new Date(tokenExpiry!).toISOString()}, ${Math.round((now - tokenExpiry!) / 1000)}s ago. User must reconnect.`
      );
    } else {
      this.log('info', 'storage', 'Token already applied to in-memory state — no update needed',
        'Expected: _accessToken signal already holds a valid token from a previous call. Actual: both in-memory and localStorage have valid tokens — consistent state.');
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
   * Syncs a single blood pressure entry to Google Fit if connected and not already synced.
   * Designed for fire-and-forget use immediately after logging a new BP reading.
   * Silently no-ops when disconnected or when the entry has already been pushed.
   */
  async syncBpEntry(entry: BloodPressureEntry): Promise<void> {
    this.log('info', 'bp-auto-sync', `syncBpEntry() — entry ${entry.id} (${entry.date}, ${entry.systolic}/${entry.diastolic} mmHg)`);
    const token = this._accessToken();
    if (!token) {
      this.log('info', 'bp-auto-sync', 'Skipped — not connected');
      return;
    }

    const settings = this._settings();
    if (settings.syncedBpEntryIds.includes(entry.id)) {
      this.log('info', 'bp-auto-sync', `Skipped — entry ${entry.id} already synced`);
      return;
    }

    try {
      const dataSourceId = await this.ensureBpDataSource(token);
      this.log('info', 'bp-auto-sync', `Using BP data source: ${dataSourceId}`);
      const ms = new Date(entry.date).getTime();
      const ns = String(ms * 1_000_000);

      const patchUrl = `${FITNESS_API}/dataSources/${encodeURIComponent(dataSourceId)}/datasets/${ns}-${ns}`;
      this.log('info', 'bp-auto-sync', `PATCH ${patchUrl}`);
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
            dataTypeName: 'com.google.blood_pressure',
            startTimeNanos: ns,
            endTimeNanos: ns,
            value: [
              { fpVal: entry.systolic },
              { fpVal: entry.diastolic },
              { intVal: 0 }, // body_position: unknown
              { intVal: 0 }, // measurement_location: unknown
            ],
          }],
        }),
      });

      if (!patchRes.ok) {
        this.log('warn', 'bp-auto-sync', `PATCH failed — status ${patchRes.status} — entry will not be marked as synced`);
        return;
      }

      this.log('info', 'bp-auto-sync', `PATCH response: ${patchRes.status} — BP entry ${entry.id} synced successfully`);
      const updatedIds = [...this._settings().syncedBpEntryIds, entry.id];
      this._settings.set({ ...this._settings(), syncedBpEntryIds: updatedIds });
      this.saveSettings();
    } catch (err: unknown) {
      this.log('error', 'bp-auto-sync', `BP auto-sync error: ${err instanceof Error ? err.message : String(err)}`);
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
        clientSecret: s.clientSecret ?? '',
        lastSyncDate: s.lastSyncDate ?? null,
        syncedEntryIds: Array.isArray(s.syncedEntryIds) ? s.syncedEntryIds : [],
        syncedBpEntryIds: Array.isArray((s as any).syncedBpEntryIds) ? (s as any).syncedBpEntryIds : [],
        accessToken: s.accessToken ?? null,
        tokenExpiry: s.tokenExpiry ?? null,
        refreshToken: (s as any).refreshToken ?? null,
      };
      this._settings.set(restored);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(restored));
      // Restore token signal if the recovered token is still valid.
      const valid = this.getValidStoredToken();
      if (valid) {
        this._accessToken.set(valid);
        this.scheduleRefresh(restored.tokenExpiry!);
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
    const remainingSec = Math.round((expiry - Date.now()) / 1000);
    this.log('info', 'token',
      `Persisting token — expires at ${new Date(expiry).toISOString()} (in ${remainingSec}s after 60s safety buffer)`,
      `Token length: ${token.length}. Raw expires_in: ${expiresIn}s. Effective expiry: ${remainingSec}s from now. ` +
      `Writing to localStorage key "${SETTINGS_KEY}" and IndexedDB. ` +
      `Expected: isConnected() becomes true. Next action: user can import/export data.`
    );
    this._settings.set({ ...this._settings(), accessToken: token, tokenExpiry: expiry });
    this._accessToken.set(token);
    this.saveSettings();
    this.log('info', 'token', 'Token saved to localStorage and queued for IndexedDB write',
      `Expected: localStorage.getItem("${SETTINGS_KEY}") now contains accessToken and tokenExpiry. Verify in DevTools → Application → Local Storage.`
    );
    this.scheduleRefresh(expiry);
  }

  /**
   * Clears the access token from signal and persisted settings.
   * Does NOT clear the refresh token — callers that want full disconnection
   * (e.g. disconnect()) should also call clearRefreshToken().
   */
  private clearToken(): void {
    this.log('info', 'token', 'Access token cleared from state and storage');
    if (this._refreshTimer !== null) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._settings.set({ ...this._settings(), accessToken: null, tokenExpiry: null });
    this._accessToken.set(null);
    this.saveSettings();
  }

  /** Persists a refresh token to settings (localStorage + IndexedDB). */
  private storeRefreshToken(refreshToken: string): void {
    this.log('info', 'token', 'Refresh token stored — silent renewal will be available',
      'Expected: next token expiry will trigger an automatic silent refresh via refresh_token grant.');
    this._settings.set({ ...this._settings(), refreshToken });
    this.saveSettings();
  }

  /** Clears the refresh token (called on full disconnect). */
  private clearRefreshToken(): void {
    this.log('info', 'token', 'Refresh token cleared');
    this._settings.set({ ...this._settings(), refreshToken: null });
    this.saveSettings();
  }

  /**
   * Schedules a proactive token refresh (or expiry clear when refresh is
   * unavailable).
   *
   * With a refresh token (any mode):
   *   Fires 5 minutes before expiry and exchanges the refresh token for a new
   *   access token via the token endpoint — no user interaction required.
   *
   * Browser mode without refresh token (clientId present, not standalone PWA):
   *   Fires 5 minutes before expiry and attempts a silent GIS popup refresh.
   *   If the refresh fails the token remains valid until actual expiry, so a
   *   second timer is set to clear it then.
   *
   * Standalone PWA / no clientId and no refresh token:
   *   No silent refresh is possible; simply clears the token at expiry so the
   *   UI never displays a stale connected state.
   */
  private scheduleRefresh(expiry: number): void {
    if (this._refreshTimer !== null) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    const hasRefreshToken = !!this._settings().refreshToken;
    const canRefresh = hasRefreshToken || (!!this._settings().clientId && !this.isStandalonePwa());
    if (canRefresh) {
      const delay = Math.max(0, expiry - 5 * 60_000 - Date.now());
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this.log('info', 'token', 'Proactive token refresh triggered (5 min before expiry)');
        this.tryRefreshToken(/* clearOnFailure */ false).then(ok => {
          if (!ok) {
            // Refresh failed but token is still technically valid; clear at actual expiry.
            const remaining = expiry - Date.now();
            this.log('warn', 'token',
              `Proactive refresh failed — will clear token in ${Math.round(remaining / 1000)}s`);
            this._refreshTimer = setTimeout(() => {
              this._refreshTimer = null;
              this.log('info', 'token', 'Token expired after failed proactive refresh — clearing');
              this.clearToken();
            }, Math.max(0, remaining));
          }
        });
      }, delay);
    } else {
      // No silent refresh available — clear the token when it actually expires.
      const delay = Math.max(0, expiry - Date.now());
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this.log('info', 'token', 'Token expired — clearing (no silent refresh available in this mode)');
        this.clearToken();
      }, delay);
    }
  }

  /**
   * Returns a human-readable "Connected to Google Fit …" label describing
   * when the current token expires.
   * - < 60 minutes remaining  → "Connected to Google Fit for N more minute(s)."
   * - ≥ 60 minutes, same day  → "Connected to Google Fit until HH:MM."
   * - ≥ 60 minutes, tomorrow  → "Connected to Google Fit until tomorrow HH:MM."
   */
  private formatConnectedLabel(expiry: number | null, now = Date.now()): string {
    if (!expiry) return 'Connected to Google Fit.';
    const remainingMs = expiry - now;
    const remainingMin = Math.floor(remainingMs / 60000);
    if (remainingMin < 1) {
      return 'Connected to Google Fit for less than a minute.';
    }
    if (remainingMin < 60) {
      const words: Record<number, string> = {
        1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
        6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
        11: 'eleven', 12: 'twelve',
      };
      const label = words[remainingMin] ?? String(remainingMin);
      return `Connected to Google Fit for ${label} more minute${remainingMin === 1 ? '' : 's'}.`;
    }
    const expiryDate = new Date(expiry);
    const hh = String(expiryDate.getHours()).padStart(2, '0');
    const mm = String(expiryDate.getMinutes()).padStart(2, '0');
    const time = `${hh}:${mm}`;
    const today = new Date(now);
    // Compare calendar days by zeroing the time portion
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfExpiry = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());
    const daysDiff = Math.round((startOfExpiry.getTime() - startOfToday.getTime()) / 86_400_000);
    if (daysDiff === 0) {
      return `Connected to Google Fit until ${time}.`;
    }
    if (daysDiff === 1) {
      return `Connected to Google Fit until tomorrow ${time}.`;
    }
    if (daysDiff < 6) {
      const weekday = expiryDate.toLocaleDateString('en-GB', { weekday: 'long' });
      return `Connected to Google Fit until ${weekday} ${time}.`;
    }
    const day = expiryDate.getDate();
    const month = expiryDate.toLocaleDateString('en-GB', { month: 'short' });
    return `Connected to Google Fit until ${day} ${month} ${time}.`;
  }

  /**
   * Attempts a silent token refresh via GIS popup with prompt=''.
   * Only available when not in standalone PWA mode (popup is usable).
   * Returns true if a new token was obtained.
   *
   * @param clearOnFailure When true (default), clears the token immediately on
   *   failure — appropriate for reactive 401 recovery. Pass false for proactive
   *   pre-expiry refreshes where the token is still valid and should not be
   *   invalidated until it actually expires.
   */
  private async tryRefreshToken(clearOnFailure = true): Promise<boolean> {
    // Prefer refresh_token grant — works in all modes including standalone PWA.
    if (this._settings().refreshToken) {
      this.log('info', 'token', 'Attempting silent token refresh via refresh_token grant');
      try {
        const ok = await this.refreshAccessToken();
        if (ok) return true;
        this.log('warn', 'token', 'refresh_token grant failed — falling back to GIS popup if available');
      } catch (err: unknown) {
        this.log('warn', 'token', `refresh_token grant threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Fall back to GIS popup (browser mode only — requires window.opener).
    const clientId = this._settings().clientId;
    if (!clientId || this.isStandalonePwa()) {
      this.log('warn', 'token', `Silent refresh skipped — ${!clientId ? 'no client ID' : 'standalone PWA mode, no GIS popup available'}`);
      if (clearOnFailure) this.clearToken();
      return false;
    }
    this.log('info', 'token', 'Attempting silent token refresh via GIS popup');
    try {
      await this.loadGsiScript();
      const { token, expiresIn } = await this.requestTokenViaPopup(clientId);
      this.persistToken(token, expiresIn);
      this.log('info', 'token', `Silent refresh via GIS popup succeeded, expires in ${expiresIn}s`);
      return true;
    } catch (err: unknown) {
      this.log('warn', 'token', `Silent refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      if (clearOnFailure) this.clearToken();
      return false;
    }
  }

  /**
   * Uses a stored refresh token to obtain a new access token from Google's
   * token endpoint without user interaction.  Works in all modes including
   * standalone PWA.  Returns true on success.
   */
  private async refreshAccessToken(): Promise<boolean> {
    const refreshToken = this._settings().refreshToken;
    const clientId = this._settings().clientId;
    const clientSecret = this._settings().clientSecret;

    if (!refreshToken || !clientId) {
      this.log('warn', 'token', 'refreshAccessToken() skipped — no refresh token or client ID');
      return false;
    }

    const tokenParams: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    };
    if (clientSecret) {
      tokenParams['client_secret'] = clientSecret;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams),
    });
    const data = await res.json();

    if (!res.ok || !data.access_token) {
      const errCode = data.error ?? `HTTP ${res.status}`;
      const errDesc = data.error_description ?? '(no description)';
      this.log('error', 'token',
        `refresh_token grant failed — ${errCode}: ${errDesc}`,
        errCode === 'invalid_grant'
          ? 'Refresh token has been revoked or expired. User must reconnect.'
          : `Full response: ${JSON.stringify(data)}`
      );
      if (errCode === 'invalid_grant') {
        // Refresh token is no longer valid — clear it so we don't retry endlessly.
        this.clearRefreshToken();
      }
      return false;
    }

    const expiresIn = Number(data.expires_in ?? 3599);
    this.log('info', 'token',
      `refresh_token grant succeeded — new access token expires in ${expiresIn}s`,
      data.refresh_token ? 'Rotated refresh token also received and stored.' : 'No rotated refresh token returned.'
    );
    this.persistToken(data.access_token as string, expiresIn);
    // Google may rotate the refresh token — store the new one if provided.
    if (data.refresh_token) {
      this.storeRefreshToken(data.refresh_token as string);
    }
    return true;
  }

  /** Loads the Google Identity Services script if not already present. */
  private loadGsiScript(): Promise<void> {
    if ((window as any).google?.accounts?.oauth2) {
      this.log('info', 'gsi', 'google.accounts.oauth2 already present — skipping script load',
        'Expected: API available. Actual: already loaded. OK.');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (existing) {
        this.log('info', 'gsi', 'GSI <script> tag already in DOM but API not yet available — awaiting load event',
          'Expected: script loads then resolves. If it hangs, check for CSP violations blocking accounts.google.com in DevTools console.');
        existing.addEventListener('load', () => {
          this.log('info', 'gsi', 'GSI script (pre-existing) loaded — google.accounts.oauth2 now available');
          resolve();
        });
        existing.addEventListener('error', () => {
          this.log('error', 'gsi', 'GSI script (pre-existing) failed to load',
            `Expected: https://accounts.google.com/gsi/client loads successfully. Actual: onerror fired. ` +
            `Check: (1) network connectivity, (2) Content-Security-Policy script-src must allow 'https://accounts.google.com', ` +
            `(3) no ad blocker or privacy extension blocking Google scripts.`
          );
          reject(new Error('GSI script failed to load'));
        });
        return;
      }
      this.log('info', 'gsi', 'Injecting GSI <script src="https://accounts.google.com/gsi/client"> into <head>',
        'Expected: script fetches, executes, and populates window.google.accounts.oauth2. Check DevTools Network tab for the request status.');
      const injectedAt = Date.now();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        const elapsed = Date.now() - injectedAt;
        const apiAvailable = !!(window as any).google?.accounts?.oauth2;
        this.log(apiAvailable ? 'info' : 'warn', 'gsi',
          `GSI script loaded in ${elapsed}ms — google.accounts.oauth2 available: ${apiAvailable}`,
          apiAvailable
            ? 'Expected: API available after script load. Actual: OK.'
            : 'Expected: window.google.accounts.oauth2 to be defined after script load. Actual: still undefined. The script may have loaded but not initialised — this is unusual and may indicate an error within the GSI script itself.'
        );
        if (apiAvailable) resolve();
        else reject(new Error('GSI script loaded but google.accounts.oauth2 is not available'));
      };
      script.onerror = () => {
        this.log('error', 'gsi', 'GSI script failed to load — onerror fired',
          `Expected: https://accounts.google.com/gsi/client fetches successfully. Actual: network or CSP error. ` +
          `Fix: (1) Verify internet connectivity. (2) Check Content-Security-Policy — script-src must include 'https://accounts.google.com'. ` +
          `(3) Disable browser extensions that block Google scripts. (4) Check DevTools → Network for the request status code.`
        );
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
    this.log('info', 'oauth',
      'Initialising GIS token client for popup flow',
      `Config: client_id="…${clientId.slice(-20)}", scope="${SCOPES}", prompt="" (consent only on first use). ` +
      `Expected: popup opens at accounts.google.com, user signs in, callback fires with access_token.`
    );
    return new Promise((resolve, reject) => {
      const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp: any) => {
          if (resp.error) {
            this.log('error', 'oauth',
              `Popup OAuth error: "${resp.error}"`,
              `error_description: "${resp.error_description ?? '(none)'}". ` +
              (resp.error === 'access_denied'
                ? 'Expected: user grants consent. Actual: denied. Add your account as a Test User in Cloud Console → OAuth consent screen → Test users.'
                : resp.error === 'popup_closed_by_user'
                ? 'Expected: user completes sign-in. Actual: popup closed without completing. User dismissed the popup.'
                : resp.error === 'popup_blocked_by_browser'
                ? 'Expected: popup to open. Actual: browser blocked popup. Allow popups for this site, or trigger connect() from a direct user gesture (button click).'
                : resp.error === 'invalid_client'
                ? `Expected: valid client_id. Actual: Google rejected the client_id. Verify the Client ID ends with ".apps.googleusercontent.com" and the origin "${window.location.origin}" is listed in Authorised JavaScript origins.`
                : `Full response: ${JSON.stringify(resp)}`)
            );
            reject(new Error(`OAuth error: ${resp.error_description ?? resp.error}`));
          } else {
            const expiresIn = Number(resp.expires_in ?? 3599);
            const hasToken = !!resp.access_token;
            const tokenType = resp.token_type ?? '(not set)';
            const grantedScope = resp.scope ?? '(not set)';
            this.log('info', 'oauth',
              `Popup OAuth success — token received, length: ${(resp.access_token as string)?.length ?? 0}, expires_in: ${expiresIn}s, token_type: ${tokenType}`,
              `Expected: access_token string, token_type="Bearer", expires_in~3599, scope includes fitness.body. ` +
              `Actual: hasToken=${hasToken}, tokenType="${tokenType}", expires_in=${expiresIn}, scope="${grantedScope}". ` +
              (grantedScope.includes('fitness.body') ? 'Scope OK.' : `WARNING: granted scope "${grantedScope}" does not include fitness.body — import/export may fail with 403.`)
            );
            resolve({
              token: resp.access_token as string,
              expiresIn,
            });
          }
        },
        error_callback: (err: any) => {
          this.log('error', 'oauth',
            `Popup error_callback: ${err?.type ?? err?.message ?? 'unknown'}`,
            `Full error object: ${JSON.stringify(err)}. ` +
            (err?.type === 'popup_closed' || err?.message?.includes('closed')
              ? 'Expected: user completes sign-in. Actual: popup closed early. Check if popup was blocked or user dismissed it.'
              : 'Unexpected error from GIS — see full error object for details.')
          );
          reject(new Error(err?.message ?? 'OAuth popup closed'));
        },
      });
      this.log('info', 'oauth', 'Calling tokenClient.requestAccessToken({ prompt: "" })',
        'Expected: GIS opens popup window at accounts.google.com. If nothing happens, the browser may have blocked the popup (must be triggered by a user gesture).');
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  /**
   * Resets status from 'connecting' to 'idle'.
   * Called by SyncComponent when the user returns from the auth page without
   * completing the flow (e.g. dismisses Google sign-in).
   */
  resetToIdle(): void {
    if (this._status() === 'connecting') {
      this.log('info', 'connect', 'resetToIdle() — user returned without completing auth, resetting to idle');
      this._status.set('idle');
      this._message.set('');
    }
  }

  /**
   * Exchanges a PKCE authorization code for an access token.
   * Called by handleRedirectCallback() or SyncComponent when ?code= appears in
   * the URL after Android brings the PWA to the foreground.
   */
  async exchangeCodeForToken(code: string, state: string): Promise<void> {
    if (this._accessToken()) {
      this.log('info', 'pkce', 'exchangeCodeForToken skipped — already connected');
      return;
    }
    this.log('info', 'pkce', `exchangeCodeForToken() called — code length: ${code.length}`);
    const storedState = localStorage.getItem('gfit_pkce_state');
    const verifier = localStorage.getItem('gfit_pkce_verifier');

    if (!storedState || state !== storedState) {
      this.log('error', 'pkce',
        `State mismatch — stored: "${storedState ?? 'null'}", received: "${state}"`,
        'Expected: state values match (CSRF protection). Actual: mismatch. This may indicate a forged redirect or stale PKCE session. Aborting.'
      );
      this._status.set('error');
      this._message.set('Sign-in failed: security check failed (state mismatch). Please try again.');
      return;
    }

    if (!verifier) {
      this.log('error', 'pkce', 'code_verifier not found in localStorage',
        'Expected: gfit_pkce_verifier set before navigation. Actual: missing. localStorage may have been cleared during auth flow.');
      this._status.set('error');
      this._message.set('Sign-in failed: PKCE verifier missing. Please try again.');
      return;
    }

    const clientId = this._settings().clientId;
    const clientSecret = this._settings().clientSecret;
    this.log('info', 'pkce',
      `Exchanging code for token — POST https://oauth2.googleapis.com/token`,
      `client_id: "…${clientId.slice(-20)}", redirect_uri: "${this.redirectUri}", code_verifier length: ${verifier.length}, ` +
      `client_secret: ${clientSecret ? 'provided' : 'not provided'}. ` +
      `Expected: 200 with { access_token, expires_in, token_type }.`
    );

    this._status.set('connecting');
    this._message.set('Completing sign-in…');

    try {
      const tokenParams: Record<string, string> = {
        code,
        client_id: clientId,
        redirect_uri: this.redirectUri,
        code_verifier: verifier,
        grant_type: 'authorization_code',
      };
      if (clientSecret) {
        tokenParams['client_secret'] = clientSecret;
      }
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenParams),
      });

      const data = await res.json();

      if (!res.ok || !data.access_token) {
        const errCode = data.error ?? `HTTP ${res.status}`;
        const errDesc = data.error_description ?? '(no description)';
        this.log('error', 'pkce',
          `Token exchange failed — ${errCode}: ${errDesc}`,
          `Full response: ${JSON.stringify(data)}. ` +
          (errCode === 'invalid_grant'
            ? 'The authorization code has expired or already been used. Codes are single-use and expire in seconds. Try connecting again.'
            : errCode === 'redirect_uri_mismatch'
            ? `The redirect_uri "${this.redirectUri}" must match exactly what was used in the auth request AND be registered in Cloud Console.`
            : errCode === 'invalid_client'
            ? 'Client ID not recognised or does not support PKCE. Ensure OAuth client type is "Web application" in Cloud Console.'
            : `See https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors`)
        );
        this._status.set('error');
        this._message.set(errCode === 'invalid_grant'
          ? 'Sign-in code expired — please try connecting again.'
          : `Sign-in failed: ${errDesc || errCode}`
        );
        return;
      }

      const expiresIn = Number(data.expires_in ?? 3599);
      const hasRefreshToken = !!data.refresh_token;
      this.log('info', 'pkce',
        `Token exchange succeeded — expires_in: ${expiresIn}s, token_type: "${data.token_type}", refresh_token: ${hasRefreshToken ? 'received' : 'not returned'}`,
        `scope: "${data.scope ?? '(not returned)'}". Expected: access_token present, token_type="Bearer", expires_in~3599. ` +
        (hasRefreshToken
          ? 'Refresh token received — silent renewal enabled.'
          : 'No refresh token returned. If access_type=offline was sent, ensure this is a fresh consent (not a re-auth). Google only returns refresh_token on first authorization or after revoking access.')
      );

      this.persistToken(data.access_token as string, expiresIn);
      if (hasRefreshToken) {
        this.storeRefreshToken(data.refresh_token as string);
      }
      this._status.set('idle');
      this._message.set('Connected to Google Fit.');

      localStorage.removeItem('gfit_pkce_verifier');
      localStorage.removeItem('gfit_pkce_state');
      this.log('info', 'pkce', 'PKCE verifier/state cleaned from localStorage');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('error', 'pkce', `Token exchange network error: ${msg}`,
        'Expected: fetch to succeed. Check internet connectivity and that Google APIs are not blocked.');
      this._status.set('error');
      this._message.set('Sign-in failed: could not reach Google servers. Check your connection and try again.');
    }
  }

  /** Generates a PKCE code_verifier and code_challenge pair using Web Crypto. */
  private async generatePkce(): Promise<{ verifier: string; challenge: string }> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const verifier = btoa(String.fromCharCode(...Array.from(array)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
    const challenge = btoa(String.fromCharCode(...Array.from(new Uint8Array(hashBuffer))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return { verifier, challenge };
  }

  /** Generates a random opaque state value for CSRF protection. */
  private generateState(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...Array.from(array)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * PKCE Authorization Code Flow for standalone PWA:
   * generates PKCE params, saves them to localStorage, then navigates to Google's
   * auth page.  Google redirects to /sync?code=...&state=...  Android's intent
   * system intercepts the in-scope URL, closes the CCT, and navigates the WebAPK
   * WebView to /sync?code=... so handleRedirectCallback() can read the code
   * directly from window.location.search — no cross-context storage involved.
   */
  private async startPkceFlow(clientId: string): Promise<void> {
    const pkce = await this.generatePkce();
    const state = this.generateState();

    localStorage.setItem('gfit_pkce_verifier', pkce.verifier);
    localStorage.setItem('gfit_pkce_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this.redirectUri,
      scope: SCOPES,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    this.log('info', 'pkce',
      `PKCE flow ready — navigating to Google auth`,
      `redirect_uri: "${this.redirectUri}". code_challenge_method: S256. ` +
      `Expected: Google redirects to "${this.redirectUri}?code=...&state=..." — Android intent closes CCT, ` +
      `navigates WebAPK to /sync?code=..., handleRedirectCallback() exchanges code for token.`
    );
    window.location.href = authUrl;
  }

  /** Redirect flow (standalone PWA): navigates the page to Google's auth endpoint. */
  private startRedirectFlow(clientId: string): void {
    this.log('info', 'oauth',
      `Starting redirect flow — ux_mode: "redirect"`,
      `Config: client_id="…${clientId.slice(-20)}", scope="${SCOPES}", ux_mode="redirect", redirect_uri="${this.redirectUri}". ` +
      `Expected: browser navigates to accounts.google.com. After sign-in Google redirects to "${this.redirectUri}" with #access_token=... in the hash. ` +
      `/oauth.html reads the token, writes to localStorage, broadcasts via BroadcastChannel, then redirects to /sync. ` +
      `The PWA picks up the token via refreshFromStorage() or BroadcastChannel on visibilitychange. ` +
      `IMPORTANT: "${this.redirectUri}" MUST be listed in Cloud Console → Credentials → OAuth 2.0 Client → Authorised redirect URIs.`
    );
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      ux_mode: 'redirect',
      redirect_uri: this.redirectUri,
      callback: () => {}, // not called during the outbound redirect
    });
    tokenClient.requestAccessToken({ prompt: '' });
    // The browser navigates away; nothing after this line runs.
    this.log('info', 'oauth', 'requestAccessToken() called — browser should be navigating to Google now',
      'If the page does not navigate, GIS may have thrown a silent error. Check for console errors above.');
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

  private async ensureBpDataSource(token: string): Promise<string> {
    const listUrl = `${FITNESS_API}/dataSources?dataTypeName=com.google.blood_pressure`;
    this.log('info', 'bp-datasource', `Listing BP data sources — GET ${listUrl}`);
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    this.log(listRes.ok ? 'info' : 'error', 'bp-datasource', `List response: ${listRes.status} ${listRes.statusText}`);
    if (!listRes.ok) throw new Error(`Failed to list BP data sources: ${listRes.status}`);

    const listData = await listRes.json();
    const sources: any[] = listData.dataSource ?? [];
    const existing = sources.find(
      s => s.dataStreamName === 'weight-track-bp' && s.dataType?.name === 'com.google.blood_pressure'
    );
    if (existing) {
      this.log('info', 'bp-datasource', `Reusing existing BP source: ${existing.dataStreamId}`);
      return existing.dataStreamId as string;
    }

    this.log('info', 'bp-datasource', 'No weight-track-bp source found — creating new BP data source');
    const createRes = await fetch(`${FITNESS_API}/dataSources`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dataStreamName: 'weight-track-bp',
        type: 'raw',
        application: { name: 'WeightTrack', version: '1' },
        dataType: { name: 'com.google.blood_pressure' },
      }),
    });
    this.log(createRes.ok ? 'info' : 'error', 'bp-datasource', `Create response: ${createRes.status} ${createRes.statusText}`);
    if (!createRes.ok) {
      const body = await createRes.text();
      this.log('error', 'bp-datasource', `Create BP data source error body`, body.substring(0, 500));
      throw new Error(`Failed to create BP data source: ${createRes.status}: ${body}`);
    }
    const created = await createRes.json();
    this.log('info', 'bp-datasource', `BP data source created: ${created.dataStreamId}`);
    return created.dataStreamId as string;
  }

  /**
   * Logs a structured snapshot of the current browser/device environment.
   * Called at the start of connect() to provide baseline diagnostic context.
   */
  private logEnvironment(caller: string): void {
    const standalone = this.isStandalonePwa();
    const displayMode =
      window.matchMedia('(display-mode: standalone)').matches ? 'standalone' :
      window.matchMedia('(display-mode: minimal-ui)').matches ? 'minimal-ui' :
      window.matchMedia('(display-mode: fullscreen)').matches ? 'fullscreen' :
      'browser';
    const iosSafariStandalone = (window.navigator as any).standalone === true;
    const online = navigator.onLine;
    const ua = navigator.userAgent;
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua);
    const isChrome = /Chrome/i.test(ua);
    const cookiesEnabled = navigator.cookieEnabled;
    const storageEstimate = typeof navigator.storage?.estimate === 'function' ? 'supported' : 'not supported';

    this.log('info', caller,
      `Environment snapshot — displayMode: "${displayMode}", isStandalonePwa: ${standalone}, platform: ${isAndroid ? 'Android' : isIOS ? 'iOS' : 'desktop'}`,
      `online: ${online}, cookies: ${cookiesEnabled}, storageEstimate: ${storageEstimate}, ` +
      `displayMode: "${displayMode}", navigator.standalone (iOS): ${iosSafariStandalone}, ` +
      `browser: ${isChrome ? 'Chrome' : isSafari ? 'Safari' : 'other'}, ` +
      `Android: ${isAndroid}, iOS: ${isIOS}. ` +
      `Origin: "${window.location.origin}". ` +
      `Expected redirect_uri: "${this.redirectUri}". ` +
      `UA: "${ua.substring(0, 120)}${ua.length > 120 ? '…' : ''}"`
    );
  }

  /**
   * Tests whether localStorage is available and writable.
   * Returns false if storage is full or blocked (e.g. Safari private mode).
   */
  private checkLocalStorage(): boolean {
    try {
      const testKey = '__gfit_ls_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  private loadSettings(): GoogleFitSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        clientId: parsed.clientId ?? '',
        clientSecret: parsed.clientSecret ?? '',
        lastSyncDate: parsed.lastSyncDate ?? null,
        syncedEntryIds: Array.isArray(parsed.syncedEntryIds) ? parsed.syncedEntryIds : [],
        syncedBpEntryIds: Array.isArray(parsed.syncedBpEntryIds) ? parsed.syncedBpEntryIds : [],
        accessToken: parsed.accessToken ?? null,
        tokenExpiry: parsed.tokenExpiry ?? null,
        refreshToken: parsed.refreshToken ?? null,
      };
    } catch {
      return { clientId: '', clientSecret: '', lastSyncDate: null, syncedEntryIds: [], syncedBpEntryIds: [], accessToken: null, tokenExpiry: null, refreshToken: null };
    }
  }

  private saveSettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings()));
    this.db.write(SETTINGS_KEY, this._settings()).catch(() => {});
  }
}
