import { TestBed } from '@angular/core/testing';
import { GoogleFitService } from './google-fit';
import { WeightEntry } from '../models/weight-entry';

// Helper: nanosecond timestamp string from an ISO date string
function dateToNs(date: string): string {
  return String(new Date(date).getTime() * 1_000_000);
}

describe('GoogleFitService', () => {
  let service: GoogleFitService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(GoogleFitService);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts disconnected with idle status', () => {
    expect(service.isConnected()).toBe(false);
    expect(service.status()).toBe('idle');
    expect(service.message()).toBe('');
  });

  it('loads an empty client ID when no settings are stored', () => {
    expect(service.settings().clientId).toBe('');
    expect(service.settings().lastSyncDate).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // setClientId
  // ---------------------------------------------------------------------------

  it('setClientId trims and persists the client ID', () => {
    service.setClientId('  my-client-id.apps.googleusercontent.com  ');
    expect(service.settings().clientId).toBe('my-client-id.apps.googleusercontent.com');
    const raw = JSON.parse(localStorage.getItem('weight_google_fit')!);
    expect(raw.clientId).toBe('my-client-id.apps.googleusercontent.com');
  });

  // ---------------------------------------------------------------------------
  // connect — without a client ID
  // ---------------------------------------------------------------------------

  it('connect sets error status when no client ID is configured', async () => {
    await service.connect();
    expect(service.status()).toBe('error');
    expect(service.message()).toContain('Client ID');
    expect(service.isConnected()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // disconnect
  // ---------------------------------------------------------------------------

  it('disconnect clears the access token and sets idle status', () => {
    service.disconnect();
    expect(service.isConnected()).toBe(false);
    expect(service.status()).toBe('idle');
    expect(service.message()).toContain('Disconnected');
  });

  // ---------------------------------------------------------------------------
  // importFromGoogleFit — not connected
  // ---------------------------------------------------------------------------

  it('importFromGoogleFit returns 0 and sets message when not connected', async () => {
    const addEntry = vi.fn();
    const count = await service.importFromGoogleFit(addEntry);
    expect(count).toBe(0);
    expect(addEntry).not.toHaveBeenCalled();
    expect(service.message()).toContain('Not connected');
  });

  // ---------------------------------------------------------------------------
  // exportToGoogleFit — not connected / empty list
  // ---------------------------------------------------------------------------

  it('exportToGoogleFit returns 0 when not connected', async () => {
    const count = await service.exportToGoogleFit([]);
    expect(count).toBe(0);
  });

  it('exportToGoogleFit sets "no entries" message when connected but list is empty', async () => {
    (service as any)._accessToken.set('fake-token');
    const count = await service.exportToGoogleFit([]);
    expect(count).toBe(0);
    expect(service.message()).toContain('No entries');
  });

  // ---------------------------------------------------------------------------
  // importFromGoogleFit — mock fetch (connected state)
  // ---------------------------------------------------------------------------

  describe('importFromGoogleFit with mocked fetch', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = window.fetch;
      // Simulate connected state by writing directly to the private signal
      (service as any)._accessToken.set('fake-token');
    });

    afterEach(() => {
      window.fetch = originalFetch;
    });

    it('parses data points and calls addEntry for each', async () => {
      window.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            point: [
              { startTimeNanos: dateToNs('2024-03-01'), value: [{ fpVal: 80.5 }] },
              { startTimeNanos: dateToNs('2024-03-05'), value: [{ fpVal: 79.8 }] },
            ],
          }),
          { status: 200 }
        )
      );

      const addEntry = vi.fn();
      const count = await service.importFromGoogleFit(addEntry);

      expect(count).toBe(2);
      expect(addEntry).toHaveBeenCalledTimes(2);
      expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ date: '2024-03-01', weight: 80.5 }));
      expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ date: '2024-03-05', weight: 79.8 }));
      expect(service.status()).toBe('success');
      expect(service.settings().lastSyncDate).not.toBeNull();
    });

    it('handles an empty point array gracefully', async () => {
      window.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ point: [] }), { status: 200 })
      );

      const addEntry = vi.fn();
      const count = await service.importFromGoogleFit(addEntry);

      expect(count).toBe(0);
      expect(addEntry).not.toHaveBeenCalled();
      expect(service.status()).toBe('success');
    });

    it('handles a response with no "point" key', async () => {
      window.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const addEntry = vi.fn();
      const count = await service.importFromGoogleFit(addEntry);

      expect(count).toBe(0);
      expect(service.status()).toBe('success');
    });

    it('sets error status when the API returns non-200', async () => {
      window.fetch = vi.fn().mockResolvedValue(
        new Response('Unauthorized', { status: 401 })
      );

      const count = await service.importFromGoogleFit(vi.fn());

      expect(count).toBe(0);
      expect(service.status()).toBe('error');
      expect(service.message()).toContain('401');
    });

    it('sets error status when fetch rejects (network error)', async () => {
      window.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const count = await service.importFromGoogleFit(vi.fn());

      expect(count).toBe(0);
      expect(service.status()).toBe('error');
      expect(service.message()).toContain('Network error');
    });
  });

  // ---------------------------------------------------------------------------
  // exportToGoogleFit — mock fetch (connected state)
  // ---------------------------------------------------------------------------

  describe('exportToGoogleFit with mocked fetch', () => {
    let originalFetch: typeof fetch;

    const entries: WeightEntry[] = [
      { id: '1', date: '2024-03-01', weight: 80.0 },
      { id: '2', date: '2024-03-05', weight: 79.5 },
    ];

    beforeEach(() => {
      originalFetch = window.fetch;
      (service as any)._accessToken.set('fake-token');
    });

    afterEach(() => {
      window.fetch = originalFetch;
    });

    it('creates a data source and patches the dataset, returns entry count', async () => {
      window.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (typeof url === 'string' && url.includes('dataSources?dataTypeName')) {
          return Promise.resolve(new Response(JSON.stringify({ dataSource: [] }), { status: 200 }));
        }
        if (opts?.method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({ dataStreamId: 'raw:com.google.weight:test-app:weight-track' }),
              { status: 200 }
            )
          );
        }
        if (opts?.method === 'PATCH') {
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
        }
        return Promise.resolve(new Response('Not found', { status: 404 }));
      });

      const count = await service.exportToGoogleFit(entries);

      expect(count).toBe(2);
      expect(service.status()).toBe('success');
      expect(service.message()).toContain('2 entries');
      expect(service.settings().lastSyncDate).not.toBeNull();
    });

    it('reuses an existing data source without creating a new one', async () => {
      const existingId = 'raw:com.google.weight:existing:weight-track';
      const fetchSpy = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (typeof url === 'string' && url.includes('dataSources?dataTypeName')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                dataSource: [
                  {
                    dataStreamId: existingId,
                    dataStreamName: 'weight-track',
                    dataType: { name: 'com.google.weight' },
                  },
                ],
              }),
              { status: 200 }
            )
          );
        }
        if (opts?.method === 'PATCH') {
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
        }
        return Promise.resolve(new Response('Unexpected', { status: 500 }));
      });

      window.fetch = fetchSpy;

      const count = await service.exportToGoogleFit(entries);

      expect(count).toBe(2);
      // POST (create data source) should NOT have been called
      const postCalls = fetchSpy.mock.calls.filter((args: unknown[]) => (args[1] as RequestInit | undefined)?.method === 'POST');
      expect(postCalls).toHaveLength(0);
    });

    it('sets error status when PATCH returns non-200', async () => {
      window.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (typeof url === 'string' && url.includes('dataSources?dataTypeName')) {
          return Promise.resolve(new Response(JSON.stringify({ dataSource: [] }), { status: 200 }));
        }
        if (opts?.method === 'POST') {
          return Promise.resolve(
            new Response(
              JSON.stringify({ dataStreamId: 'raw:com.google.weight:test:weight-track' }),
              { status: 200 }
            )
          );
        }
        if (opts?.method === 'PATCH') {
          return Promise.resolve(new Response('Bad Request', { status: 400 }));
        }
        return Promise.resolve(new Response('', { status: 500 }));
      });

      const count = await service.exportToGoogleFit(entries);

      expect(count).toBe(0);
      expect(service.status()).toBe('error');
      expect(service.message()).toContain('400');
    });
  });

  // ---------------------------------------------------------------------------
  // Settings persistence
  // ---------------------------------------------------------------------------

  it('persists settings to localStorage on setClientId', () => {
    service.setClientId('client-abc');
    const raw = JSON.parse(localStorage.getItem('weight_google_fit')!);
    expect(raw.clientId).toBe('client-abc');
  });

  it('loads settings from localStorage on construction', () => {
    localStorage.setItem(
      'weight_google_fit',
      JSON.stringify({ clientId: 'saved-id', lastSyncDate: '2024-01-01T00:00:00.000Z' })
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(GoogleFitService);
    expect(fresh.settings().clientId).toBe('saved-id');
    expect(fresh.settings().lastSyncDate).toBe('2024-01-01T00:00:00.000Z');
  });

  it('falls back to defaults when localStorage contains invalid JSON', () => {
    localStorage.setItem('weight_google_fit', '{bad json');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(GoogleFitService);
    expect(fresh.settings().clientId).toBe('');
    expect(fresh.settings().lastSyncDate).toBeNull();
  });
});
