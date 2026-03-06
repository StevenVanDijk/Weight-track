import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe, DatePipe } from '@angular/common';
import { WeightService } from '../../services/weight';

export { DashboardComponent };

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DecimalPipe, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
class DashboardComponent {
  protected readonly weightService = inject(WeightService);
  protected readonly stats = this.weightService.stats;
  protected readonly entries = this.weightService.entries;

  get recentEntries() {
    return this.entries().slice(-5).reverse();
  }

  get progressToGoal(): number | null {
    const s = this.stats();
    if (!s.goalWeight || !s.startWeight || !s.current) return null;
    const total = Math.abs(s.startWeight - s.goalWeight);
    if (total === 0) return 100;
    const done = Math.abs(s.startWeight - s.current);
    return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
  }
}
