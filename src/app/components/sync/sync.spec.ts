import { TestBed } from '@angular/core/testing';
import { SyncComponent } from './sync';
import { GoogleFitService } from '../../services/google-fit';
import { WeightService } from '../../services/weight';

describe('SyncComponent', () => {
  let handleRedirectCallbackSpy: ReturnType<typeof vi.fn>;
  let refreshFromStorageSpy: ReturnType<typeof vi.fn>;

  function buildModule(refreshReturns = false) {
    handleRedirectCallbackSpy = vi.fn().mockResolvedValue(undefined);
    refreshFromStorageSpy = vi.fn().mockReturnValue(refreshReturns);

    TestBed.configureTestingModule({
      imports: [SyncComponent],
      providers: [
        {
          provide: GoogleFitService,
          useValue: {
            handleRedirectCallback: handleRedirectCallbackSpy,
            refreshFromStorage: refreshFromStorageSpy,
            settings: () => ({ clientId: '', lastSyncDate: null }),
            isConnected: () => false,
            status: () => 'idle',
            message: () => '',
            logs: () => [],
            logsExpanded: () => false,
            importedCount: () => 0,
            exportedCount: () => 0,
            redirectUri: 'https://example.com/sync',
            connect: vi.fn(),
            disconnect: vi.fn(),
            setClientId: vi.fn(),
            downloadLogs: vi.fn(),
            clearLogs: vi.fn(),
          },
        },
        {
          provide: WeightService,
          useValue: {
            entries: () => [],
            addEntry: vi.fn(),
          },
        },
      ],
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls handleRedirectCallback on construction (no fromVisibilityChange arg)', () => {
    buildModule();
    TestBed.createComponent(SyncComponent);
    expect(handleRedirectCallbackSpy).toHaveBeenCalledTimes(1);
    // Constructor call passes no argument (fromVisibilityChange defaults to false)
    expect(handleRedirectCallbackSpy).toHaveBeenCalledWith();
  });

  it('calls refreshFromStorage then handleRedirectCallback(true) when the page becomes visible and no token in storage', () => {
    vi.useFakeTimers();
    buildModule(false); // refreshFromStorage returns false → no token found in storage
    TestBed.createComponent(SyncComponent);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshFromStorageSpy).toHaveBeenCalledTimes(1);
    // handleRedirectCallback called once on construction + once after visibility change
    expect(handleRedirectCallbackSpy).toHaveBeenCalledTimes(2);
    // The visibility-change call must pass fromVisibilityChange=true to avoid a false error
    expect(handleRedirectCallbackSpy).toHaveBeenCalledWith(true);
    vi.useRealTimers();
  });

  it('retries refreshFromStorage after 500ms delay when token not found on first try', () => {
    vi.useFakeTimers();
    buildModule(false);
    TestBed.createComponent(SyncComponent);
    refreshFromStorageSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshFromStorageSpy).toHaveBeenCalledTimes(1);

    // After 500ms, a retry should fire since isConnected() returns false
    vi.advanceTimersByTime(500);
    expect(refreshFromStorageSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry refreshFromStorage when already connected', () => {
    vi.useFakeTimers();
    buildModule(false);
    // Override isConnected to return true (simulates BroadcastChannel token arrival)
    const gfitMock = TestBed.inject(GoogleFitService) as any;
    gfitMock.isConnected = () => true;
    TestBed.createComponent(SyncComponent);
    refreshFromStorageSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshFromStorageSpy).toHaveBeenCalledTimes(1);

    // After 500ms, retry should NOT fire since isConnected() returns true
    vi.advanceTimersByTime(500);
    expect(refreshFromStorageSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('skips handleRedirectCallback when refreshFromStorage finds a token in storage (CCT scenario)', () => {
    vi.useFakeTimers();
    buildModule(true); // refreshFromStorage returns true → token recovered from CCT
    TestBed.createComponent(SyncComponent);
    handleRedirectCallbackSpy.mockClear();
    refreshFromStorageSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshFromStorageSpy).toHaveBeenCalledTimes(1);
    // Token already found — no need to check the URL hash
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not call refreshFromStorage or handleRedirectCallback when the page becomes hidden', () => {
    vi.useFakeTimers();
    buildModule();
    TestBed.createComponent(SyncComponent);
    handleRedirectCallbackSpy.mockClear();
    refreshFromStorageSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshFromStorageSpy).not.toHaveBeenCalled();
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('removes the visibilitychange listener when the component is destroyed', () => {
    vi.useFakeTimers();
    buildModule();
    const fixture = TestBed.createComponent(SyncComponent);
    handleRedirectCallbackSpy.mockClear();
    refreshFromStorageSpy.mockClear();

    fixture.destroy();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(refreshFromStorageSpy).not.toHaveBeenCalled();
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500); // ensure no delayed retry fires after destroy
    expect(refreshFromStorageSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
