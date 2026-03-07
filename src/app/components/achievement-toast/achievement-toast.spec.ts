import { TestBed, ComponentFixture } from '@angular/core/testing';
import { AchievementToastComponent } from './achievement-toast';
import { GamificationService } from '../../services/gamification';
import { WeightService } from '../../services/weight';

describe('AchievementToastComponent', () => {
  let fixture: ComponentFixture<AchievementToastComponent>;
  let component: AchievementToastComponent;
  let gam: GamificationService;
  let weight: WeightService;

  beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [AchievementToastComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(AchievementToastComponent);
    component = fixture.componentInstance;
    gam = TestBed.inject(GamificationService);
    weight = TestBed.inject(WeightService);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('starts with an empty queue', () => {
    expect((component as any).queue()).toEqual([]);
  });

  it('starts not visible', () => {
    expect((component as any).visible()).toBe(false);
  });

  it('current() returns null when queue is empty', () => {
    expect((component as any).current()).toBeNull();
  });

  it('picks up newly unlocked achievements via the polling interval', () => {
    weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
    gam.onEntryAdded(); // sets newlyUnlocked on the service

    vi.advanceTimersByTime(500); // trigger one poll cycle
    fixture.detectChanges();

    expect((component as any).queue().length).toBeGreaterThan(0);
  });

  it('becomes visible when an achievement is queued', () => {
    weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
    gam.onEntryAdded();

    vi.advanceTimersByTime(500);
    fixture.detectChanges();

    expect((component as any).visible()).toBe(true);
  });

  it('clears newlyUnlocked on the service after picking up achievements', () => {
    weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
    gam.onEntryAdded();

    vi.advanceTimersByTime(500);
    expect(gam.state().newlyUnlocked).toEqual([]);
  });

  it('hides toast after 3500ms and dequeues after a further 400ms', () => {
    weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
    gam.onEntryAdded();

    vi.advanceTimersByTime(500);   // pick up achievements
    expect((component as any).visible()).toBe(true);

    vi.advanceTimersByTime(3500);  // hide
    expect((component as any).visible()).toBe(false);

    vi.advanceTimersByTime(400);   // dequeue
    expect((component as any).queue().length).toBe(0);
  });

  it('current() returns first item in queue', () => {
    weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
    gam.onEntryAdded();
    vi.advanceTimersByTime(500);
    const q = (component as any).queue();
    expect((component as any).current()).toBe(q[0]);
  });

  it('clears the polling interval on destroy', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    component.ngOnDestroy();
    expect(clearSpy).toHaveBeenCalled();
  });
});
