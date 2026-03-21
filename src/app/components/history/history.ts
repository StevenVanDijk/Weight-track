import { Component, inject, signal, computed } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { WeightService } from '../../services/weight';
import { BloodPressureService } from '../../services/blood-pressure';
import { WeightEntry } from '../../models/weight-entry';
import { BloodPressureEntry } from '../../models/blood-pressure-entry';

export { HistoryComponent };

@Component({
  selector: 'app-history',
  imports: [DecimalPipe, DatePipe],
  templateUrl: './history.html',
  styleUrl: './history.scss',
})
class HistoryComponent {
  protected readonly weightService = inject(WeightService);
  protected readonly bpService = inject(BloodPressureService);
  protected readonly tab = signal<'weight' | 'bp'>('weight');
  protected readonly entries = computed(() => [...this.weightService.entries()].reverse());
  protected readonly settings = this.weightService.settings;
  protected readonly deleteConfirm = signal<string | null>(null);

  protected readonly bpEntries = computed(() => [...this.bpService.entries()].reverse());
  protected readonly bpDeleteConfirm = signal<string | null>(null);

  protected setTab(t: 'weight' | 'bp'): void {
    this.tab.set(t);
  }

  protected confirmDelete(id: string): void {
    this.deleteConfirm.set(id);
  }

  protected cancelDelete(): void {
    this.deleteConfirm.set(null);
  }

  protected doDelete(id: string): void {
    this.weightService.deleteEntry(id);
    this.deleteConfirm.set(null);
  }

  protected exportData(): void {
    this.weightService.exportData();
  }

  protected getDelta(entry: WeightEntry, index: number): number | null {
    const all = this.entries();
    if (index >= all.length - 1) return null;
    return Math.round((entry.weight - all[index + 1].weight) * 10) / 10;
  }

  protected confirmBpDelete(id: string): void {
    this.bpDeleteConfirm.set(id);
  }

  protected cancelBpDelete(): void {
    this.bpDeleteConfirm.set(null);
  }

  protected doBpDelete(id: string): void {
    this.bpService.deleteEntry(id);
    this.bpDeleteConfirm.set(null);
  }

  protected getSystolicDelta(entry: BloodPressureEntry, index: number): number | null {
    const all = this.bpEntries();
    if (index >= all.length - 1) return null;
    return entry.systolic - all[index + 1].systolic;
  }
}
