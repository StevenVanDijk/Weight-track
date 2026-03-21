import { Injectable, signal, computed, inject } from '@angular/core';
import { BloodPressureEntry, BloodPressureStats } from '../models/blood-pressure-entry';
import { DbService } from '../db';

const BP_ENTRIES_KEY = 'bp_entries';
const BP_SETTINGS_KEY = 'bp_settings';

export interface BpSettings {
  targetSystolic: number | null;
  targetDiastolic: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class BloodPressureService {
  private readonly db = inject(DbService);

  private _entries = signal<BloodPressureEntry[]>(this.loadEntries());
  private _settings = signal<BpSettings>(this.loadSettings());

  readonly entries = computed(() =>
    [...this._entries()].sort((a, b) => a.date.localeCompare(b.date))
  );

  readonly settings = this._settings.asReadonly();

  readonly stats = computed<BloodPressureStats>(() => {
    const sorted = this.entries();
    if (sorted.length === 0) {
      return {
        latest: null,
        avgSystolic: null, avgDiastolic: null,
        minSystolic: null, maxSystolic: null,
        minDiastolic: null, maxDiastolic: null,
      };
    }
    const last = sorted[sorted.length - 1];
    const systolics = sorted.map(e => e.systolic);
    const diastolics = sorted.map(e => e.diastolic);
    const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    return {
      latest: { systolic: last.systolic, diastolic: last.diastolic },
      avgSystolic: avg(systolics),
      avgDiastolic: avg(diastolics),
      minSystolic: Math.min(...systolics),
      maxSystolic: Math.max(...systolics),
      minDiastolic: Math.min(...diastolics),
      maxDiastolic: Math.max(...diastolics),
    };
  });

  addEntry(entry: Omit<BloodPressureEntry, 'id'>): void {
    const newEntry: BloodPressureEntry = { ...entry, id: crypto.randomUUID() };
    const existing = this._entries().findIndex(e => e.date === entry.date);
    if (existing >= 0) {
      const updated = [...this._entries()];
      updated[existing] = newEntry;
      this._entries.set(updated);
    } else {
      this._entries.set([...this._entries(), newEntry]);
    }
    this.saveEntries();
  }

  deleteEntry(id: string): void {
    this._entries.set(this._entries().filter(e => e.id !== id));
    this.saveEntries();
  }

  updateSettings(settings: Partial<BpSettings>): void {
    this._settings.set({ ...this._settings(), ...settings });
    this.saveSettings();
  }

  /** Called by APP_INITIALIZER. If localStorage was evicted, restores from IndexedDB. */
  async restoreFromDb(): Promise<void> {
    const [entriesRaw, settingsRaw] = await Promise.all([
      localStorage.getItem(BP_ENTRIES_KEY) ? Promise.resolve(undefined) : this.db.read(BP_ENTRIES_KEY),
      localStorage.getItem(BP_SETTINGS_KEY) ? Promise.resolve(undefined) : this.db.read(BP_SETTINGS_KEY),
    ]);

    if (entriesRaw !== undefined && Array.isArray(entriesRaw)) {
      this._entries.set(entriesRaw as BloodPressureEntry[]);
      localStorage.setItem(BP_ENTRIES_KEY, JSON.stringify(entriesRaw));
    }

    if (settingsRaw !== undefined && settingsRaw && typeof settingsRaw === 'object') {
      const defaults: BpSettings = { targetSystolic: null, targetDiastolic: null };
      const s = { ...defaults, ...(settingsRaw as BpSettings) };
      this._settings.set(s);
      localStorage.setItem(BP_SETTINGS_KEY, JSON.stringify(s));
    }
  }

  private loadEntries(): BloodPressureEntry[] {
    try {
      const data = localStorage.getItem(BP_ENTRIES_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveEntries(): void {
    const data = this._entries();
    localStorage.setItem(BP_ENTRIES_KEY, JSON.stringify(data));
    this.db.write(BP_ENTRIES_KEY, data).catch(() => {});
  }

  private loadSettings(): BpSettings {
    const defaults: BpSettings = { targetSystolic: null, targetDiastolic: null };
    try {
      const data = localStorage.getItem(BP_SETTINGS_KEY);
      return data ? { ...defaults, ...JSON.parse(data) } : defaults;
    } catch {
      return defaults;
    }
  }

  private saveSettings(): void {
    const data = this._settings();
    localStorage.setItem(BP_SETTINGS_KEY, JSON.stringify(data));
    this.db.write(BP_SETTINGS_KEY, data).catch(() => {});
  }
}
