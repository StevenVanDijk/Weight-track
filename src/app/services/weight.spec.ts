import { TestBed } from '@angular/core/testing';
import { WeightService } from './weight';
import { DbService } from '../db';

const STORAGE_KEY = 'weight_entries';
const SETTINGS_KEY = 'weight_settings';

/** A controllable mock for DbService used throughout these tests. */
const mockDb = {
  read:  vi.fn().mockResolvedValue(undefined),
  write: vi.fn().mockResolvedValue(undefined),
};

describe('WeightService', () => {
  let service: WeightService;

  beforeEach(() => {
    localStorage.clear();
    mockDb.read.mockReset();
    mockDb.read.mockResolvedValue(undefined);
    mockDb.write.mockReset();
    mockDb.write.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: DbService, useValue: mockDb }],
    });
    service = TestBed.inject(WeightService);
  });

  afterEach(() => localStorage.clear());

  // ─── Initialisation ────────────────────────────────────────────────────────

  describe('initialisation', () => {
    it('starts with an empty entries list', () => {
      expect(service.entries()).toEqual([]);
    });

    it('starts with default settings (no goal, reminders off)', () => {
      expect(service.settings().goalWeight).toBeNull();
      expect(service.settings().reminderEnabled).toBe(false);
    });

    it('loads persisted entries from localStorage on construction', () => {
      const stored = [{ id: 'abc', date: '2024-01-01', weight: 80 }];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(WeightService);
      expect(fresh.entries().length).toBe(1);
      expect(fresh.entries()[0].weight).toBe(80);
    });

    it('loads persisted settings from localStorage on construction', () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ goalWeight: 70, reminderEnabled: true }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(WeightService);
      expect(fresh.settings().goalWeight).toBe(70);
      expect(fresh.settings().reminderEnabled).toBe(true);
    });

    it('falls back to defaults when localStorage contains invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json');
      localStorage.setItem(SETTINGS_KEY, 'not-json');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(WeightService);
      expect(fresh.entries()).toEqual([]);
      expect(fresh.settings().goalWeight).toBeNull();
    });
  });

  // ─── addEntry ──────────────────────────────────────────────────────────────

  describe('addEntry', () => {
    it('adds an entry and assigns a unique id', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      expect(service.entries().length).toBe(1);
      expect(service.entries()[0].id).toBeTruthy();
    });

    it('generates different ids for each entry', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.addEntry({ date: '2024-01-02', weight: 79 });
      const ids = service.entries().map(e => e.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('persists entries to localStorage', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.length).toBe(1);
    });

    it('sorts entries by date ascending', () => {
      service.addEntry({ date: '2024-01-03', weight: 78 });
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.addEntry({ date: '2024-01-02', weight: 79 });
      const dates = service.entries().map(e => e.date);
      expect(dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    });

    it('replaces an existing entry when the same date is used', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.addEntry({ date: '2024-01-01', weight: 82 });
      expect(service.entries().length).toBe(1);
      expect(service.entries()[0].weight).toBe(82);
    });

    it('stores the optional note when provided', () => {
      service.addEntry({ date: '2024-01-01', weight: 80, note: 'morning' });
      expect(service.entries()[0].note).toBe('morning');
    });

    it('entry has no note property when none provided', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      expect(service.entries()[0].note).toBeUndefined();
    });
  });

  // ─── deleteEntry ───────────────────────────────────────────────────────────

  describe('deleteEntry', () => {
    it('removes the entry with the matching id', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      const id = service.entries()[0].id;
      service.deleteEntry(id);
      expect(service.entries().length).toBe(0);
    });

    it('only removes the targeted entry', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.addEntry({ date: '2024-01-02', weight: 79 });
      const id = service.entries()[0].id;
      service.deleteEntry(id);
      expect(service.entries().length).toBe(1);
      expect(service.entries()[0].date).toBe('2024-01-02');
    });

    it('is a no-op when the id does not exist', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.deleteEntry('nonexistent-id');
      expect(service.entries().length).toBe(1);
    });

    it('persists the deletion to localStorage', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      const id = service.entries()[0].id;
      service.deleteEntry(id);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.length).toBe(0);
    });
  });

  // ─── updateSettings ────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('updates goalWeight', () => {
      service.updateSettings({ goalWeight: 70 });
      expect(service.settings().goalWeight).toBe(70);
    });

    it('persists settings to localStorage', () => {
      service.updateSettings({ goalWeight: 65 });
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
      expect(stored.goalWeight).toBe(65);
    });

    it('merges partial updates without losing other settings', () => {
      service.updateSettings({ goalWeight: 70 });
      service.updateSettings({ reminderEnabled: true });
      expect(service.settings().goalWeight).toBe(70);
      expect(service.settings().reminderEnabled).toBe(true);
    });

    it('can clear goalWeight by setting it to null', () => {
      service.updateSettings({ goalWeight: 70 });
      service.updateSettings({ goalWeight: null });
      expect(service.settings().goalWeight).toBeNull();
    });
  });

  // ─── stats (empty) ─────────────────────────────────────────────────────────

  describe('stats with no entries', () => {
    it('returns null for all weight values', () => {
      const s = service.stats();
      expect(s.current).toBeNull();
      expect(s.startWeight).toBeNull();
      expect(s.minWeight).toBeNull();
      expect(s.maxWeight).toBeNull();
      expect(s.avgWeight).toBeNull();
      expect(s.totalChange).toBeNull();
      expect(s.weeklyChange).toBeNull();
    });

    it('reflects goalWeight from settings', () => {
      service.updateSettings({ goalWeight: 70 });
      expect(service.stats().goalWeight).toBe(70);
    });
  });

  // ─── stats (with data) ─────────────────────────────────────────────────────

  describe('stats with entries', () => {
    beforeEach(() => {
      service.addEntry({ date: '2024-01-01', weight: 90 });
      service.addEntry({ date: '2024-01-05', weight: 88 });
      service.addEntry({ date: '2024-01-10', weight: 86 });
    });

    it('current is the most recent entry weight', () => {
      expect(service.stats().current).toBe(86);
    });

    it('startWeight is the earliest entry weight', () => {
      expect(service.stats().startWeight).toBe(90);
    });

    it('minWeight is the lowest recorded weight', () => {
      expect(service.stats().minWeight).toBe(86);
    });

    it('maxWeight is the highest recorded weight', () => {
      expect(service.stats().maxWeight).toBe(90);
    });

    it('avgWeight is the mean rounded to 1 decimal', () => {
      expect(service.stats().avgWeight).toBeCloseTo((90 + 88 + 86) / 3, 1);
    });

    it('totalChange is current minus start, rounded to 1 decimal', () => {
      expect(service.stats().totalChange).toBe(-4);
    });

    it('weeklyChange is null when no entries older than 7 days exist', () => {
      // All 3 entries are within 10 days — depends on "now". Reset with recent dates.
      localStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      service = TestBed.inject(WeightService);
      const today = new Date().toISOString().split('T')[0];
      service.addEntry({ date: today, weight: 85 });
      expect(service.stats().weeklyChange).toBeNull();
    });

    it('weeklyChange compares current weight to nearest entry before 7-day cutoff', () => {
      localStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      service = TestBed.inject(WeightService);
      const old = new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      service.addEntry({ date: old, weight: 90 });
      service.addEntry({ date: today, weight: 87 });
      expect(service.stats().weeklyChange).toBe(-3);
    });
  });

  // ─── exportData ────────────────────────────────────────────────────────────

  describe('exportData', () => {
    let anchor: HTMLAnchorElement;
    let clickSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      clickSpy = vi.fn();
      anchor = document.createElement('a');
      vi.spyOn(anchor, 'click').mockImplementation(clickSpy as () => void);
      vi.spyOn(document, 'createElement').mockReturnValue(anchor);
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
      URL.revokeObjectURL = vi.fn();
    });

    it('triggers an anchor click for download', () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.exportData();
      expect(clickSpy).toHaveBeenCalled();
      expect(anchor.download).toMatch(/weight-data-.*\.json/);
    });

    it('exports all entries sorted by date ascending', () => {
      service.addEntry({ date: '2024-01-03', weight: 82 });
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.addEntry({ date: '2024-01-02', weight: 81 });

      let capturedJson = '';
      const origStringify = JSON.stringify;
      vi.spyOn(JSON, 'stringify').mockImplementationOnce((value: unknown, ...args: unknown[]) => {
        capturedJson = origStringify(value, ...(args as [any, any]));
        return capturedJson;
      });

      service.exportData();

      const exported: { date: string; weight: number }[] = JSON.parse(capturedJson);
      expect(exported).toHaveLength(3);
      const dates = exported.map(e => e.date);
      expect(dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    });
  });

  // ─── restoreFromDb ─────────────────────────────────────────────────────────

  describe('restoreFromDb', () => {
    it('does not call db.read when localStorage already has both keys', async () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      service.updateSettings({ goalWeight: null }); // ensures SETTINGS_KEY is in localStorage too
      mockDb.read.mockClear();
      await service.restoreFromDb();
      expect(mockDb.read).not.toHaveBeenCalled();
    });

    it('restores entries from IndexedDB when localStorage is empty', async () => {
      const fakeEntries = [{ id: 'abc', date: '2024-01-01', weight: 80 }];
      mockDb.read
        .mockResolvedValueOnce(fakeEntries as unknown) // entries key
        .mockResolvedValueOnce(undefined as unknown);  // settings key
      localStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: DbService, useValue: mockDb }] });
      service = TestBed.inject(WeightService);

      await service.restoreFromDb();

      expect(service.entries().length).toBe(1);
      expect(service.entries()[0].weight).toBe(80);
    });

    it('writes restored entries back to localStorage', async () => {
      const fakeEntries = [{ id: 'abc', date: '2024-01-01', weight: 80 }];
      mockDb.read
        .mockResolvedValueOnce(fakeEntries as unknown)
        .mockResolvedValueOnce(undefined as unknown);
      localStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: DbService, useValue: mockDb }] });
      service = TestBed.inject(WeightService);

      await service.restoreFromDb();

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored).toEqual(fakeEntries);
    });

    it('restores settings from IndexedDB when localStorage is empty', async () => {
      mockDb.read
        .mockResolvedValueOnce(undefined as unknown) // entries key
        .mockResolvedValueOnce({ goalWeight: 72, reminderEnabled: true } as unknown);
      localStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: DbService, useValue: mockDb }] });
      service = TestBed.inject(WeightService);

      await service.restoreFromDb();

      expect(service.settings().goalWeight).toBe(72);
      expect(service.settings().reminderEnabled).toBe(true);
    });

    it('does not overwrite existing entries when IndexedDB returns undefined', async () => {
      service.addEntry({ date: '2024-01-01', weight: 80 });
      // localStorage has data, so read won't be called anyway
      await service.restoreFromDb();
      expect(service.entries().length).toBe(1);
    });
  });
});
