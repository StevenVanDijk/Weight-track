import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AchievementsComponent } from './achievements';
import { GamificationService } from '../../services/gamification';
import { WeightService } from '../../services/weight';
import { LEVELS, ALL_ACHIEVEMENTS } from '../../models/achievement';

describe('AchievementsComponent', () => {
  let fixture: ComponentFixture<AchievementsComponent>;
  let component: AchievementsComponent;
  let gam: GamificationService;
  let weight: WeightService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AchievementsComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(AchievementsComponent);
    component = fixture.componentInstance;
    gam = TestBed.inject(GamificationService);
    weight = TestBed.inject(WeightService);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('shows the current level number', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('1'); // level 1
  });

  it('shows the level title (Beginner at start)', async () => {
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Beginner');
  });

  it('shows 0 XP initially', async () => {
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('0 XP');
  });

  it('has currentStreak of 0 initially in state', () => {
    expect(gam.state().currentStreak).toBe(0);
    expect(gam.state().longestStreak).toBe(0);
  });

  it('shows 0 unlocked badges initially', async () => {
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('0');
  });

  it('exposes the LEVELS array to the template', () => {
    expect((component as any).levels).toBe(LEVELS);
    expect((component as any).levels.length).toBe(5);
  });

  it('unlocked computed starts empty', () => {
    expect((component as any).unlocked().length).toBe(0);
  });

  it('locked computed contains all achievements initially', () => {
    
    expect((component as any).locked().length).toBe(ALL_ACHIEVEMENTS.length);
  });

  it('unlocked computed updates when an achievement is earned', () => {
    weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
    gam.onEntryAdded();
    fixture.detectChanges();
    expect((component as any).unlocked().length).toBeGreaterThan(0);
  });

  it('locked count decreases as achievements are earned', () => {
    
    const initialLocked = ALL_ACHIEVEMENTS.length;
    weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
    gam.onEntryAdded();
    fixture.detectChanges();
    expect((component as any).locked().length).toBeLessThan(initialLocked);
  });

  it('renders the level roadmap with 5 steps', async () => {
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const steps = el.querySelectorAll('.level-step');
    expect(steps.length).toBe(5);
  });

  it('rarityLabel map contains all 4 rarities', () => {
    const labels = (component as any).rarityLabel;
    expect(labels.common).toBe('Common');
    expect(labels.rare).toBe('Rare');
    expect(labels.epic).toBe('Epic');
    expect(labels.legendary).toBe('Legendary');
  });
});
