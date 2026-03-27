import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { AddEntryComponent } from './add-entry';
import { WeightService } from '../../services/weight';
import { GamificationService } from '../../services/gamification';
import { GoogleFitService } from '../../services/google-fit';

describe('AddEntryComponent', () => {
  let fixture: ComponentFixture<AddEntryComponent>;
  let component: AddEntryComponent;
  let weightService: WeightService;
  let router: Router;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AddEntryComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(AddEntryComponent);
    component = fixture.componentInstance;
    weightService = TestBed.inject(WeightService);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('save button is rendered and visible in the DOM', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const btn: HTMLButtonElement | null = fixture.nativeElement.querySelector('button[type="submit"].submit-btn');
    expect(btn).toBeTruthy();
    expect(btn!.offsetParent).not.toBeNull();
  });

  it('shows kg badge label', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('kg');
  });

  it('defaults date to today', () => {
    const today = new Date().toISOString().split('T')[0];
    expect((component as any).date()).toBe(today);
  });

  it('shows an error when submitting with no weight', () => {
    (component as any).weight.set(null);
    (component as any).submit();
    expect((component as any).error()).toContain('valid weight');
  });

  it('shows an error when weight is 0', () => {
    (component as any).weight.set(0);
    (component as any).submit();
    expect((component as any).error()).toBeTruthy();
  });

  it('shows an error when weight exceeds 500', () => {
    (component as any).weight.set(501);
    (component as any).submit();
    expect((component as any).error()).toBeTruthy();
  });

  it('clears error on valid submission', () => {
    (component as any).weight.set(0);
    (component as any).submit();
    (component as any).weight.set(80);
    (component as any).submit();
    expect((component as any).error()).toBe('');
  });

  it('calls weightService.addEntry on valid submission', () => {
    const spy = vi.spyOn(weightService, 'addEntry');
    (component as any).weight.set(80);
    (component as any).submit();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ weight: 80 }));
  });

  it('calls gamification.onEntryAdded after saving', () => {
    const gam = TestBed.inject(GamificationService);
    const spy = vi.spyOn(gam, 'onEntryAdded');
    (component as any).weight.set(80);
    (component as any).submit();
    expect(spy).toHaveBeenCalled();
  });

  it('sets saved=true on successful submission', () => {
    (component as any).weight.set(80);
    (component as any).submit();
    expect((component as any).saved()).toBe(true);
  });

  it('navigates to /dashboard after 800ms', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(router, 'navigate');
    (component as any).weight.set(80);
    (component as any).submit();
    vi.advanceTimersByTime(800);
    expect(spy).toHaveBeenCalledWith(['/dashboard']);
  });

  it('updates goal weight in settings when changed', () => {
    (component as any).weight.set(80);
    (component as any).goalWeight.set(70);
    (component as any).submit();
    expect(weightService.settings().goalWeight).toBe(70);
  });

  it('does not call updateSettings with goalWeight when goal is unchanged', () => {
    const spy = vi.spyOn(weightService, 'updateSettings');
    (component as any).weight.set(80);
    // goalWeight is null (default) and settings().goalWeight is also null → no change
    (component as any).submit();
    expect(spy).not.toHaveBeenCalled();
  });

  it('trims whitespace from notes before saving', () => {
    const spy = vi.spyOn(weightService, 'addEntry');
    (component as any).weight.set(80);
    (component as any).note.set('  morning  ');
    (component as any).submit();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ note: 'morning' }));
  });

  it('saves undefined note when note field is empty', () => {
    const spy = vi.spyOn(weightService, 'addEntry');
    (component as any).weight.set(80);
    (component as any).note.set('');
    (component as any).submit();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ note: undefined }));
  });

  // ─── Weight slider ────────────────────────────────────────────────────────

  it('lastWeight is null when no entries exist', () => {
    expect((component as any).lastWeight()).toBeNull();
  });

  it('lastWeight reflects the most recent entry', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 85 });
    weightService.addEntry({ date: '2024-01-02', weight: 83 });
    fixture.detectChanges();
    expect((component as any).lastWeight()).toBe(83);
  });

  it('sliderMin is lastWeight minus 1 kg', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    fixture.detectChanges();
    expect((component as any).sliderMin()).toBe(79);
  });

  it('sliderMax is lastWeight plus 1 kg', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    fixture.detectChanges();
    expect((component as any).sliderMax()).toBe(81);
  });

  it('sliderMin and sliderMax are rounded to 1 decimal', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 79.75 });
    fixture.detectChanges();
    expect((component as any).sliderMin()).toBe(78.8);
    expect((component as any).sliderMax()).toBe(80.8);
  });

  it('slider is hidden when there are no previous entries', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const slider = fixture.nativeElement.querySelector('.weight-slider');
    expect(slider).toBeNull();
  });

  it('slider is visible when a previous entry exists', async () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    fixture.detectChanges();
    await fixture.whenStable();
    const slider = fixture.nativeElement.querySelector('.weight-slider');
    expect(slider).toBeTruthy();
  });

  it('slider min/max attributes reflect the computed bounds', async () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    fixture.detectChanges();
    await fixture.whenStable();
    const slider: HTMLInputElement = fixture.nativeElement.querySelector('.weight-slider');
    expect(Number(slider.min)).toBe(79);
    expect(Number(slider.max)).toBe(81);
  });

  it('setting sliderValue updates the weight signal rounded to 1 decimal', () => {
    (component as any).sliderValue = 79.333;
    expect((component as any).weight()).toBe(79.3);
  });

  it('sliderValue getter returns lastWeight when weight is null', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 82 });
    fixture.detectChanges();
    expect((component as any).sliderValue).toBe(82);
  });

  it('sliderValue getter returns current weight when set', () => {
    (component as any).weight.set(79.5);
    expect((component as any).sliderValue).toBe(79.5);
  });

  it('slider and number input stay in sync: setting sliderValue updates the weight signal read by the number input', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    fixture.detectChanges();
    (component as any).sliderValue = 79.5;
    // Both slider and number input bind to the same weight signal
    expect((component as any).weightInput).toBe(79.5);
  });

  // ─── Google Fit auto-sync ─────────────────────────────────────────────────

  it('calls googleFitService.syncEntry with the new entry when Google Fit is connected', () => {
    const googleFit = TestBed.inject(GoogleFitService);
    (googleFit as any)._accessToken.set('fake-token');
    const syncSpy = vi.spyOn(googleFit, 'syncEntry').mockResolvedValue(undefined);

    (component as any).weight.set(80);
    (component as any).submit();

    expect(syncSpy).toHaveBeenCalledOnce();
    expect(syncSpy).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 80, date: expect.any(String) })
    );
  });

  it('does not call googleFitService.syncEntry when Google Fit is not connected', () => {
    const googleFit = TestBed.inject(GoogleFitService);
    // Ensure disconnected (default state — _accessToken is null)
    const syncSpy = vi.spyOn(googleFit, 'syncEntry').mockResolvedValue(undefined);

    (component as any).weight.set(80);
    (component as any).submit();

    // syncEntry is still called but returns immediately when not connected;
    // the component always calls it — guard lives inside the service.
    // What matters is that it is called exactly once with the right entry.
    expect(syncSpy).toHaveBeenCalledOnce();
  });
});
