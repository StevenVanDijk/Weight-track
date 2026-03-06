import { Component, inject, signal, computed } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { WeightService } from '../../services/weight';
import { WeightEntry } from '../../models/weight-entry';

export { HistoryComponent };

@Component({
  selector: 'app-history',
  imports: [DecimalPipe, DatePipe],
  templateUrl: './history.html',
  styleUrl: './history.scss',
})
class HistoryComponent {
  protected readonly weightService = inject(WeightService);
  protected readonly entries = computed(() => [...this.weightService.entries()].reverse());
  protected readonly settings = this.weightService.settings;
  protected readonly deleteConfirm = signal<string | null>(null);

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
}
