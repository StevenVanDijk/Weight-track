import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardComponent } from './dashboard';
import { WeightService } from '../../services/weight';
import { GamificationService } from '../../services/gamification';

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let weightService: WeightService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    weightService = TestBed.inject(WeightService);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('shows empty state when there are no entries', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No entries yet');
  });

  it('shows recent entries when data exists', async () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('80');
  });

  it('recentEntries returns last 5 entries in reverse order', () => {
    for (let i = 1; i <= 7; i++) {
      weightService.addEntry({ date: `2024-01-0${i}`, weight: 80 - i });
    }
    fixture.detectChanges();
    const recent = (component as any).recentEntries;
    expect(recent.length).toBe(5);
    // Most recent first
    expect(recent[0].date).toBe('2024-01-07');
  });

  it('progressToGoal returns null when no goal is set', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    fixture.detectChanges();
    expect((component as any).progressToGoal).toBeNull();
  });

  it('progressToGoal returns 0 at the start weight', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.updateSettings({ goalWeight: 70 });
    fixture.detectChanges();
    expect((component as any).progressToGoal).toBe(0);
  });

  it('progressToGoal returns 50 at the halfway point', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.addEntry({ date: '2024-01-02', weight: 80 });
    weightService.updateSettings({ goalWeight: 70 });
    fixture.detectChanges();
    expect((component as any).progressToGoal).toBe(50);
  });

  it('progressToGoal caps at 100 when goal is exceeded', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.addEntry({ date: '2024-01-02', weight: 65 });
    weightService.updateSettings({ goalWeight: 70 });
    fixture.detectChanges();
    expect((component as any).progressToGoal).toBe(100);
  });

  it('displays the gamification banner linking to /achievements', () => {
    const el: HTMLElement = fixture.nativeElement;
    const banner = el.querySelector('a.gam-banner');
    expect(banner).toBeTruthy();
  });

  it('shows goal section when a goal is set', async () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.updateSettings({ goalWeight: 70 });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Goal Progress');
  });

  it('hides goal section when no goal is set', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain('Goal Progress');
  });
});
