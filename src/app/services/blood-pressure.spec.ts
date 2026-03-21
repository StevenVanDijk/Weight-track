import { TestBed } from '@angular/core/testing';
import { BloodPressureService } from './blood-pressure';
import { DbService } from '../db';

const BP_ENTRIES_KEY = 'bp_entries';
const BP_SETTINGS_KEY = 'bp_settings';

const mockDb = {
  read:  vi.fn().mockResolvedValue(undefined),
  write: vi.fn().mockResolvedValue(undefined),
};

describe('BloodPressureService', () => {
  let service: BloodPressureService;

  beforeEach(() => {
    localStorage.clear();
    mockDb.read.mockReset();
    mockDb.read.mockResolvedValue(undefined);
    mockDb.write.mockReset();
    mockDb.write.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: DbService, useValue: mockDb }],
    });
    service = TestBed.inject(BloodPressureService);
  });

  afterEach(() => localStorage.clear());

  // ─── Initialisation ────────────────────────────────────────────────────────

  describe('initialisation', () => {
    it('starts with an empty entries list', () => {
      expect(service.entries()).toEqual([]);
    });

    it('starts with default settings (no targets)', () => {
      expect(service.settings().targetSystolic).toBeNull();
      expect(service.settings().targetDiastolic).toBeNull();
    });

    it('loads persisted entries from localStorage on construction', () => {
      const stored = [{ id: 'abc', date: '2024-01-01', systolic: 120, diastolic: 80 }];
      localStorage.setItem(BP_ENTRIES_KEY, JSON.stringify(stored));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: DbService, useValue: mockDb }] });
      const fresh = TestBed.inject(BloodPressureService);
      expect(fresh.entries().length).toBe(1);
      expect(fresh.entries()[0].systolic).toBe(120);
    });

    it('loads persisted settings from localStorage on construction', () => {
      localStorage.setItem(BP_SETTINGS_KEY, JSON.stringify({ targetSystolic: 120, targetDiastolic: 80 }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: DbService, useValue: mockDb }] });
      const fresh = TestBed.inject(BloodPressureService);
      expect(fresh.settings().targetSystolic).toBe(120);
      expect(fresh.settings().targetDiastolic).toBe(80);
    });

    it('falls back to defaults when localStorage contains invalid JSON', () => {
      localStorage.setItem(BP_ENTRIES_KEY, 'not-json');
      localStorage.setItem(BP_SETTINGS_KEY, 'not-json');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: DbService, useValue: mockDb }] });
      const fresh = TestBed.inject(BloodPressureService);
      expect(fresh.entries()).toEqual([]);
      expect(fresh.settings().targetSystolic).toBeNull();
    });
  });

  // ─── addEntry ──────────────────────────────────────────────────────────────

  describe('addEntry', () => {
    it('adds an entry and assigns a unique id', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      expect(service.entries().length).toBe(1);
      expect(service.entries()[0].id).toBeTruthy();
    });

    it('entries are sorted ascending by date', () => {
      service.addEntry({ date: '2024-01-03', systolic: 130, diastolic: 85 });
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      expect(service.entries()[0].date).toBe('2024-01-01');
      expect(service.entries()[1].date).toBe('2024-01-03');
    });

    it('replaces an existing entry for the same date', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      service.addEntry({ date: '2024-01-01', systolic: 125, diastolic: 82 });
      expect(service.entries().length).toBe(1);
      expect(service.entries()[0].systolic).toBe(125);
    });

    it('persists entries to localStorage', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      const stored = JSON.parse(localStorage.getItem(BP_ENTRIES_KEY)!);
      expect(stored.length).toBe(1);
      expect(stored[0].systolic).toBe(120);
    });

    it('writes to IndexedDB via DbService', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      expect(mockDb.write).toHaveBeenCalledWith(BP_ENTRIES_KEY, expect.any(Array));
    });

    it('stores an optional note', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80, note: 'morning' });
      expect(service.entries()[0].note).toBe('morning');
    });
  });

  // ─── deleteEntry ───────────────────────────────────────────────────────────

  describe('deleteEntry', () => {
    it('removes the entry with the given id', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      const id = service.entries()[0].id;
      service.deleteEntry(id);
      expect(service.entries().length).toBe(0);
    });

    it('is a no-op when id does not exist', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      service.deleteEntry('non-existent-id');
      expect(service.entries().length).toBe(1);
    });

    it('persists the deletion to localStorage', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      const id = service.entries()[0].id;
      service.deleteEntry(id);
      const stored = JSON.parse(localStorage.getItem(BP_ENTRIES_KEY)!);
      expect(stored.length).toBe(0);
    });
  });

  // ─── updateSettings ────────────────────────────────────────────────────────

  describe('updateSettings', () => {
    it('updates a single setting without clobbering others', () => {
      service.updateSettings({ targetSystolic: 120 });
      expect(service.settings().targetSystolic).toBe(120);
      expect(service.settings().targetDiastolic).toBeNull();
    });

    it('persists settings to localStorage', () => {
      service.updateSettings({ targetSystolic: 120, targetDiastolic: 80 });
      const stored = JSON.parse(localStorage.getItem(BP_SETTINGS_KEY)!);
      expect(stored.targetSystolic).toBe(120);
      expect(stored.targetDiastolic).toBe(80);
    });

    it('clears a target by setting it to null', () => {
      service.updateSettings({ targetSystolic: 120 });
      service.updateSettings({ targetSystolic: null });
      expect(service.settings().targetSystolic).toBeNull();
    });
  });

  // ─── stats ─────────────────────────────────────────────────────────────────

  describe('stats', () => {
    it('returns all nulls when no entries exist', () => {
      const s = service.stats();
      expect(s.latest).toBeNull();
      expect(s.avgSystolic).toBeNull();
      expect(s.avgDiastolic).toBeNull();
    });

    it('returns the latest entry as current reading', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      service.addEntry({ date: '2024-01-02', systolic: 130, diastolic: 85 });
      expect(service.stats().latest?.systolic).toBe(130);
      expect(service.stats().latest?.diastolic).toBe(85);
    });

    it('calculates averages correctly', () => {
      service.addEntry({ date: '2024-01-01', systolic: 120, diastolic: 80 });
      service.addEntry({ date: '2024-01-02', systolic: 130, diastolic: 90 });
      expect(service.stats().avgSystolic).toBe(125);
      expect(service.stats().avgDiastolic).toBe(85);
    });

    it('calculates min and max correctly', () => {
      service.addEntry({ date: '2024-01-01', systolic: 110, diastolic: 70 });
      service.addEntry({ date: '2024-01-02', systolic: 140, diastolic: 95 });
      const s = service.stats();
      expect(s.minSystolic).toBe(110);
      expect(s.maxSystolic).toBe(140);
      expect(s.minDiastolic).toBe(70);
      expect(s.maxDiastolic).toBe(95);
    });
  });

  // ─── restoreFromDb ─────────────────────────────────────────────────────────

  describe('restoreFromDb', () => {
    it('does nothing when localStorage already has data', async () => {
      const stored = [{ id: 'abc', date: '2024-01-01', systolic: 120, diastolic: 80 }];
      localStorage.setItem(BP_ENTRIES_KEY, JSON.stringify(stored));
      localStorage.setItem(BP_SETTINGS_KEY, JSON.stringify({ targetSystolic: null, targetDiastolic: null }));
      await service.restoreFromDb();
      expect(mockDb.read).not.toHaveBeenCalled();
    });

    it('restores entries from IndexedDB when localStorage is empty', async () => {
      const dbData = [{ id: 'xyz', date: '2024-03-01', systolic: 115, diastolic: 75 }];
      mockDb.read.mockImplementation((key: string) =>
        key === BP_ENTRIES_KEY ? Promise.resolve(dbData) : Promise.resolve(undefined)
      );
      await service.restoreFromDb();
      expect(service.entries()[0].systolic).toBe(115);
    });

    it('restores settings from IndexedDB when localStorage is empty', async () => {
      const dbSettings = { targetSystolic: 120, targetDiastolic: 80 };
      mockDb.read.mockImplementation((key: string) =>
        key === BP_SETTINGS_KEY ? Promise.resolve(dbSettings) : Promise.resolve(undefined)
      );
      await service.restoreFromDb();
      expect(service.settings().targetSystolic).toBe(120);
    });
  });
});
