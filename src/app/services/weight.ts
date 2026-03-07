import { Injectable, signal, computed, inject } from '@angular/core';
import { WeightEntry, WeightStats } from '../models/weight-entry';
import { DbService } from '../db';

const STORAGE_KEY = 'weight_entries';
const SETTINGS_KEY = 'weight_settings';

export interface AppSettings {
  goalWeight: number | null;
  reminderEnabled: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class WeightService {
  private readonly db = inject(DbService);

  private _entries = signal<WeightEntry[]>(this.loadEntries());
  private _settings = signal<AppSettings>(this.loadSettings());

  readonly entries = computed(() =>
    [...this._entries()].sort((a, b) => a.date.localeCompare(b.date))
  );

  readonly settings = this._settings.asReadonly();

  readonly stats = computed<WeightStats>(() => {
    const sorted = this.entries();
    if (sorted.length === 0) {
      return {
        current: null, startWeight: null, goalWeight: this._settings().goalWeight,
        minWeight: null, maxWeight: null, avgWeight: null,
        totalChange: null, weeklyChange: null,
      };
    }
    const weights = sorted.map(e => e.weight);
    const current = sorted[sorted.length - 1].weight;
    const startWeight = sorted[0].weight;
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
    const totalChange = current - startWeight;

    let weeklyChange: number | null = null;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    const olderEntries = sorted.filter(e => e.date <= weekAgoStr);
    if (olderEntries.length > 0) {
      weeklyChange = current - olderEntries[olderEntries.length - 1].weight;
    }

    return {
      current, startWeight, goalWeight: this._settings().goalWeight,
      minWeight, maxWeight,
      avgWeight: Math.round(avgWeight * 10) / 10,
      totalChange: Math.round(totalChange * 10) / 10,
      weeklyChange: weeklyChange !== null ? Math.round(weeklyChange * 10) / 10 : null,
    };
  });

  addEntry(entry: Omit<WeightEntry, 'id'>): void {
    const newEntry: WeightEntry = { ...entry, id: crypto.randomUUID() };
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

  updateSettings(settings: Partial<AppSettings>): void {
    this._settings.set({ ...this._settings(), ...settings });
    this.saveSettings();
  }

  requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) return Promise.resolve('denied');
    return Notification.requestPermission();
  }

  scheduleReminder(): void {
    if (Notification.permission === 'granted') {
      new Notification('Weight Tracker', {
        body: 'Time to log your weight!',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
      });
    }
  }

  /** Called by APP_INITIALIZER. If localStorage was evicted, restores from IndexedDB. */
  async restoreFromDb(): Promise<void> {
    const [entriesRaw, settingsRaw] = await Promise.all([
      localStorage.getItem(STORAGE_KEY) ? Promise.resolve(undefined) : this.db.read(STORAGE_KEY),
      localStorage.getItem(SETTINGS_KEY) ? Promise.resolve(undefined) : this.db.read(SETTINGS_KEY),
    ]);

    if (entriesRaw !== undefined && Array.isArray(entriesRaw)) {
      this._entries.set(entriesRaw as WeightEntry[]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entriesRaw));
    }

    if (settingsRaw !== undefined && settingsRaw && typeof settingsRaw === 'object') {
      const s = settingsRaw as AppSettings;
      this._settings.set(s);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    }
  }

  private loadEntries(): WeightEntry[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveEntries(): void {
    const data = this._entries();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    this.db.write(STORAGE_KEY, data).catch(() => {}); // durable backup, fire-and-forget
  }

  private loadSettings(): AppSettings {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      return data ? JSON.parse(data) : { goalWeight: null, reminderEnabled: false };
    } catch {
      return { goalWeight: null, reminderEnabled: false };
    }
  }

  private saveSettings(): void {
    const data = this._settings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    this.db.write(SETTINGS_KEY, data).catch(() => {}); // durable backup, fire-and-forget
  }

  exportData(): void {
    const data = JSON.stringify(this.entries(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weight-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
