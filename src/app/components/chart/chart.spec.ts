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
});
