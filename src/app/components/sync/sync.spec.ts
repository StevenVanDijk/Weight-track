import { TestBed } from '@angular/core/testing';
import { SyncComponent } from './sync';
import { GoogleFitService } from '../../services/google-fit';
import { WeightService } from '../../services/weight';

describe('SyncComponent', () => {
  let handleRedirectCallbackSpy: ReturnType<typeof vi.fn>;
  let resetToIdleSpy: ReturnType<typeof vi.fn>;

  function buildModule(isConnected = false) {
    handleRedirectCallbackSpy = vi.fn().mockResolvedValue(undefined);
    resetToIdleSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [SyncComponent],
      providers: [
        {
          provide: GoogleFitService,
          useValue: {
            handleRedirectCallback: handleRedirectCallbackSpy,
            resetToIdle: resetToIdleSpy,
            settings: () => ({ clientId: '', lastSyncDate: null }),
            isConnected: () => isConnected,
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('calls handleRedirectCallback on construction (no fromVisibilityChange arg)', () => {
    buildModule();
    TestBed.createComponent(SyncComponent);
    expect(handleRedirectCallbackSpy).toHaveBeenCalledTimes(1);
    // Constructor call passes no argument (fromVisibilityChange defaults to false)
    expect(handleRedirectCallbackSpy).toHaveBeenCalledWith();
  });

  it('calls handleRedirectCallback(true) after 300ms delay when page becomes visible and not connected', () => {
    vi.useFakeTimers();
    buildModule(false);
    TestBed.createComponent(SyncComponent);
    handleRedirectCallbackSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // Not called immediately — the new flow waits for Android intent navigation to settle
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();

    // Called after the 300ms settling delay
    vi.advanceTimersByTime(300);
    expect(handleRedirectCallbackSpy).toHaveBeenCalledTimes(1);
    expect(handleRedirectCallbackSpy).toHaveBeenCalledWith(true);
  });

  it('calls resetToIdle() after the URL-check delay if user dismissed the auth page', () => {
    vi.useFakeTimers();
    buildModule(false);
    TestBed.createComponent(SyncComponent);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // resetToIdle fires after 300ms settling + 1500ms retry guard
    vi.advanceTimersByTime(1800);
    expect(resetToIdleSpy).toHaveBeenCalledTimes(1);
  });

  it('skips visibilitychange callbacks when already connected', () => {
    vi.useFakeTimers();
    buildModule(true); // already connected
    TestBed.createComponent(SyncComponent);
    handleRedirectCallbackSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(2000);
    // No callbacks fired because the guard `!isConnected()` is false
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();
    expect(resetToIdleSpy).not.toHaveBeenCalled();
  });

  it('does not call handleRedirectCallback when the page becomes hidden', () => {
    vi.useFakeTimers();
    buildModule();
    TestBed.createComponent(SyncComponent);
    handleRedirectCallbackSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(2000);
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();
  });

  it('removes the visibilitychange listener when the component is destroyed', () => {
    vi.useFakeTimers();
    buildModule();
    const fixture = TestBed.createComponent(SyncComponent);
    handleRedirectCallbackSpy.mockClear();
    resetToIdleSpy.mockClear();

    fixture.destroy();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(2000);
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();
    expect(resetToIdleSpy).not.toHaveBeenCalled();
  });
});
