import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChartComponent } from './chart';
import { WeightService } from '../../services/weight';

const canvasCtxMock = () => ({
  clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  bezierCurveTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(),
  fillText: vi.fn(), closePath: vi.fn(), setLineDash: vi.fn(), scale: vi.fn(),
  createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  strokeStyle: '', lineWidth: 0, fillStyle: '', font: '', textAlign: '', lineJoin: '',
});

describe('ChartComponent', () => {
  let fixture: ComponentFixture<ChartComponent>;
  let component: ChartComponent;
  let weightService: WeightService;

  beforeEach(async () => {
    localStorage.clear();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(canvasCtxMock());

    await TestBed.configureTestingModule({
      imports: [ChartComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(ChartComponent);
    component = fixture.componentInstance;
    weightService = TestBed.inject(WeightService);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to 30d period', () => {
    expect((component as any).selectedPeriod).toBe('30d');
  });

  it('exposes all 4 period options', () => {
    const periods = (component as any).periods;
    expect(periods.map((p: any) => p.value)).toEqual(['7d', '30d', '90d', 'all']);
  });

  it('selectPeriod changes the selected period', () => {
    (component as any).selectPeriod('7d');
    expect((component as any).selectedPeriod).toBe('7d');
  });

  it('filteredEntries returns all entries when period is "all"', () => {
    for (let i = 1; i <= 5; i++) {
      weightService.addEntry({ date: `2024-01-0${i}`, weight: 80 - i });
    }
    (component as any).selectPeriod('all');
    fixture.detectChanges();
    expect((component as any).filteredEntries().length).toBe(5);
  });

  it('filteredEntries filters to entries within the selected window', () => {
    const old = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    weightService.addEntry({ date: old, weight: 85 });
    weightService.addEntry({ date: today, weight: 83 });
    (component as any).selectPeriod('30d');
    fixture.detectChanges();
    expect((component as any).filteredEntries().length).toBe(1);
    expect((component as any).filteredEntries()[0].date).toBe(today);
  });

  it('filteredEntries returns empty array when no entries fall in window', () => {
    const old = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
    weightService.addEntry({ date: old, weight: 85 });
    (component as any).selectPeriod('7d');
    fixture.detectChanges();
    expect((component as any).filteredEntries().length).toBe(0);
  });

  it('drawChart does not throw with no entries', () => {
    expect(() => (component as any).drawChart()).not.toThrow();
  });

  it('drawChart does not throw with one entry', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    expect(() => (component as any).drawChart()).not.toThrow();
  });

  it('drawChart does not throw with multiple entries', () => {
    for (let i = 1; i <= 5; i++) {
      weightService.addEntry({ date: `2024-01-0${i}`, weight: 80 - i });
    }
    expect(() => (component as any).drawChart()).not.toThrow();
  });

  it('shows a no-data message when fewer than 2 total entries', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Add at least 2');
  });

  // ─── computeTrend ───────────────────────────────────────────────────────

  describe('computeTrend', () => {
    it('returns null for fewer than 2 entries', () => {
      expect((component as any).computeTrend([])).toBeNull();
      expect((component as any).computeTrend([{ date: '2024-01-01', weight: 80 }])).toBeNull();
    });

    it('returns correct slope and intercept for a perfect linear decline', () => {
      const entries = [
        { id: '1', date: '2024-01-01', weight: 80 },
        { id: '2', date: '2024-01-02', weight: 79 },
        { id: '3', date: '2024-01-03', weight: 78 },
      ];
      const result = (component as any).computeTrend(entries);
      expect(result).not.toBeNull();
      expect(result.slope).toBeCloseTo(-1, 5);     // -1 kg/day
      expect(result.intercept).toBeCloseTo(80, 5); // 80 kg at day 0
    });

    it('returns correct slope for constant weight (no change)', () => {
      const entries = [
        { id: '1', date: '2024-01-01', weight: 75 },
        { id: '2', date: '2024-01-08', weight: 75 },
        { id: '3', date: '2024-01-15', weight: 75 },
      ];
      const result = (component as any).computeTrend(entries);
      expect(result).not.toBeNull();
      expect(result!.slope).toBeCloseTo(0, 5);
      expect(result!.intercept).toBeCloseTo(75, 5);
    });

    it('returns null when all entries have the same date (zero x-variance)', () => {
      const entries = [
        { id: '1', date: '2024-01-01', weight: 80 },
        { id: '2', date: '2024-01-01', weight: 79 },
      ];
      expect((component as any).computeTrend(entries)).toBeNull();
    });
  });

  // ─── BMI ────────────────────────────────────────────────────────────────

  describe('BMI', () => {
    it('showBmi defaults to false', () => {
      expect((component as any).showBmi()).toBe(false);
    });

    it('toggleBmi flips showBmi', () => {
      (component as any).toggleBmi();
      expect((component as any).showBmi()).toBe(true);
      (component as any).toggleBmi();
      expect((component as any).showBmi()).toBe(false);
    });

    it('heightM is null when no height is set', () => {
      expect((component as any).heightM()).toBeNull();
    });

    it('heightM converts cm to metres when height is set', () => {
      weightService.updateSettings({ height: 175 });
      fixture.detectChanges();
      expect((component as any).heightM()).toBeCloseTo(1.75, 5);
    });

    it('computeBmi returns correct value', () => {
      // 80 kg / (1.75m)^2 = 80 / 3.0625 ≈ 26.12
      const bmi = (component as any).computeBmi(80, 1.75);
      expect(bmi).toBeCloseTo(26.12, 1);
    });

    it('currentBmi is null when height is not set', () => {
      weightService.addEntry({ date: '2024-01-01', weight: 80 });
      fixture.detectChanges();
      expect((component as any).currentBmi()).toBeNull();
    });

    it('currentBmi is null when there are no entries', () => {
      weightService.updateSettings({ height: 175 });
      fixture.detectChanges();
      expect((component as any).currentBmi()).toBeNull();
    });

    it('currentBmi returns rounded BMI when height and entries are present', () => {
      weightService.updateSettings({ height: 175 });
      weightService.addEntry({ date: '2024-01-01', weight: 80 });
      fixture.detectChanges();
      const bmi = (component as any).currentBmi();
      expect(bmi).not.toBeNull();
      expect(bmi).toBeCloseTo(26.1, 1);
    });

    it('drawChart does not throw when showBmi is true and height is set', () => {
      weightService.updateSettings({ height: 175 });
      for (let i = 1; i <= 5; i++) {
        weightService.addEntry({ date: `2024-01-0${i}`, weight: 80 - i });
      }
      (component as any).showBmi.set(true);
      expect(() => (component as any).drawChart()).not.toThrow();
    });

    it('drawChart does not throw when showBmi is true but height is not set', () => {
      for (let i = 1; i <= 3; i++) {
        weightService.addEntry({ date: `2024-01-0${i}`, weight: 80 - i });
      }
      (component as any).showBmi.set(true);
      expect(() => (component as any).drawChart()).not.toThrow();
    });
  });

  // ─── trendLine signal ───────────────────────────────────────────────────

  describe('trendLine', () => {
    it('is null when fewer than 2 filtered entries', () => {
      (component as any).selectPeriod('all');
      expect((component as any).trendLine()).toBeNull();
    });

    it('is non-null with 2+ filtered entries', () => {
      weightService.addEntry({ date: '2024-01-01', weight: 85 });
      weightService.addEntry({ date: '2024-01-10', weight: 84 });
      (component as any).selectPeriod('all');
      expect((component as any).trendLine()).not.toBeNull();
    });
  });

  // ─── goalHitDate / daysLeft ─────────────────────────────────────────────

  describe('goalHitDate and daysLeft', () => {
    it('goalHitDate is null when no goal is set', () => {
      weightService.addEntry({ date: '2024-01-01', weight: 85 });
      weightService.addEntry({ date: '2024-01-10', weight: 84 });
      (component as any).selectPeriod('all');
      expect((component as any).goalHitDate()).toBeNull();
    });

    it('goalHitDate is null when trend is flat (slope ≈ 0)', () => {
      weightService.updateSettings({ goalWeight: 70 });
      weightService.addEntry({ date: '2024-01-01', weight: 80 });
      weightService.addEntry({ date: '2024-01-08', weight: 80 });
      (component as any).selectPeriod('all');
      expect((component as any).goalHitDate()).toBeNull();
    });

    it('goalHitDate is null when trend is moving away from goal', () => {
      weightService.updateSettings({ goalWeight: 70 });
      weightService.addEntry({ date: '2024-01-01', weight: 80 });
      weightService.addEntry({ date: '2024-01-10', weight: 81 });
      (component as any).selectPeriod('all');
      expect((component as any).goalHitDate()).toBeNull();
    });

    it('goalHitDate returns a Date when trend converges on goal', () => {
      weightService.updateSettings({ goalWeight: 70 });
      // ~3 kg over 30 days → -0.1 kg/day → reaches 70 in ~100 days from first entry
      weightService.addEntry({ date: '2024-01-01', weight: 80 });
      weightService.addEntry({ date: '2024-02-01', weight: 77 });
      (component as any).selectPeriod('all');
      const d = (component as any).goalHitDate();
      expect(d).toBeInstanceOf(Date);
      expect(d.getFullYear()).toBeGreaterThanOrEqual(2024);
    });

    it('daysLeft is null when goalHitDate is null', () => {
      weightService.addEntry({ date: '2024-01-01', weight: 80 });
      weightService.addEntry({ date: '2024-01-10', weight: 79 });
      (component as any).selectPeriod('all');
      expect((component as any).daysLeft()).toBeNull();
    });

    it('daysLeft is a number when goalHitDate is set', () => {
      weightService.updateSettings({ goalWeight: 70 });
      weightService.addEntry({ date: '2024-01-01', weight: 80 });
      weightService.addEntry({ date: '2024-02-01', weight: 77 });
      (component as any).selectPeriod('all');
      expect(typeof (component as any).daysLeft()).toBe('number');
    });
  });
});
