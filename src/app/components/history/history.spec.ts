import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HistoryComponent } from './history';
import { WeightService } from '../../services/weight';

describe('HistoryComponent', () => {
  let fixture: ComponentFixture<HistoryComponent>;
  let component: HistoryComponent;
  let weightService: WeightService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [HistoryComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HistoryComponent);
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
    expect(el.textContent).toContain('No weight entries yet');
  });

  it('shows entries in reverse chronological order', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.addEntry({ date: '2024-01-03', weight: 88 });
    weightService.addEntry({ date: '2024-01-02', weight: 89 });
    fixture.detectChanges();
    const entries = (component as any).entries();
    expect(entries[0].date).toBe('2024-01-03');
    expect(entries[2].date).toBe('2024-01-01');
  });

  it('shows entry count in subtitle', async () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    weightService.addEntry({ date: '2024-01-02', weight: 79 });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('2 entries');
  });

  it('displays each entry weight with kg unit', async () => {
    weightService.addEntry({ date: '2024-01-01', weight: 82.5 });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('82.5');
    expect(el.textContent).toContain('kg');
  });

  it('shows export button when entries exist', async () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Export');
  });

  it('hides export button when no entries', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain('Export');
  });

  // ─── Delete flow ───────────────────────────────────────────────────────────

  it('confirmDelete sets deleteConfirm signal to the entry id', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    const id = weightService.entries()[0].id;
    (component as any).confirmDelete(id);
    expect((component as any).deleteConfirm()).toBe(id);
  });

  it('cancelDelete clears the deleteConfirm signal', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    const id = weightService.entries()[0].id;
    (component as any).confirmDelete(id);
    (component as any).cancelDelete();
    expect((component as any).deleteConfirm()).toBeNull();
  });

  it('doDelete removes the entry and clears confirmation', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 80 });
    const id = weightService.entries()[0].id;
    (component as any).confirmDelete(id);
    (component as any).doDelete(id);
    expect(weightService.entries().length).toBe(0);
    expect((component as any).deleteConfirm()).toBeNull();
  });

  // ─── getDelta ──────────────────────────────────────────────────────────────

  it('getDelta returns null for the oldest (last in reversed list) entry', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.addEntry({ date: '2024-01-02', weight: 88 });
    fixture.detectChanges();
    // entries() is reversed: [2024-01-02, 2024-01-01]
    // index=1 is the oldest → getDelta should return null
    const entries = (component as any).entries();
    expect((component as any).getDelta(entries[1], 1)).toBeNull();
  });

  it('getDelta returns difference between consecutive entries', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.addEntry({ date: '2024-01-02', weight: 88 });
    fixture.detectChanges();
    const entries = (component as any).entries();
    // entries[0] = 2024-01-02 (88), entries[1] = 2024-01-01 (90)
    // getDelta(entries[0], 0) = 88 - 90 = -2
    expect((component as any).getDelta(entries[0], 0)).toBe(-2);
  });

  it('getDelta rounds to 1 decimal place', () => {
    weightService.addEntry({ date: '2024-01-01', weight: 90 });
    weightService.addEntry({ date: '2024-01-02', weight: 89.123 });
    fixture.detectChanges();
    const entries = (component as any).entries();
    const delta = (component as any).getDelta(entries[0], 0);
    expect(delta).toBe(-0.9); // rounded
  });

  // ─── exportData ────────────────────────────────────────────────────────────

  it('exportData delegates to weightService.exportData', () => {
    const spy = vi.spyOn(weightService, 'exportData').mockImplementation(() => {});
    (component as any).exportData();
    expect(spy).toHaveBeenCalled();
  });
});
