import { TestBed } from '@angular/core/testing';
import { SyncComponent } from './sync';
import { GoogleFitService } from '../../services/google-fit';
import { WeightService } from '../../services/weight';

describe('SyncComponent', () => {
  let handleRedirectCallbackSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handleRedirectCallbackSpy = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      imports: [SyncComponent],
      providers: [
        {
          provide: GoogleFitService,
          useValue: {
            handleRedirectCallback: handleRedirectCallbackSpy,
            settings: () => ({ clientId: '', lastSyncDate: null }),
            isConnected: () => false,
            status: () => 'idle',
            message: () => '',
            redirectUri: 'https://example.com/sync',
            connect: vi.fn(),
            disconnect: vi.fn(),
            setClientId: vi.fn(),
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls handleRedirectCallback on construction', () => {
    TestBed.createComponent(SyncComponent);
    expect(handleRedirectCallbackSpy).toHaveBeenCalledTimes(1);
  });

  it('calls handleRedirectCallback again when the page becomes visible', () => {
    TestBed.createComponent(SyncComponent);
    // Simulate app coming to foreground (e.g. after Android Custom Tab OAuth redirect)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(handleRedirectCallbackSpy).toHaveBeenCalledTimes(2);
  });

  it('does not call handleRedirectCallback when the page becomes hidden', () => {
    TestBed.createComponent(SyncComponent);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // Only the initial constructor call — not triggered for hidden state
    expect(handleRedirectCallbackSpy).toHaveBeenCalledTimes(1);
  });

  it('removes the visibilitychange listener when the component is destroyed', () => {
    const fixture = TestBed.createComponent(SyncComponent);
    // Reset call count after construction
    handleRedirectCallbackSpy.mockClear();

    fixture.destroy();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // Listener should have been removed — no additional calls
    expect(handleRedirectCallbackSpy).not.toHaveBeenCalled();
  });
});
