import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { AddEntryComponent } from './add-entry';
import { WeightService } from '../../services/weight';
import { GamificationService } from '../../services/gamification';

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
});
