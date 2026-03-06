import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WeightService } from '../../services/weight';

export { AddEntryComponent };

@Component({
  selector: 'app-add-entry',
  imports: [FormsModule],
  templateUrl: './add-entry.html',
  styleUrl: './add-entry.scss',
})
class AddEntryComponent {
  private readonly router = inject(Router);
  protected readonly weightService = inject(WeightService);

  protected weight = signal<number | null>(null);
  protected date = signal(new Date().toISOString().split('T')[0]);
  protected note = signal('');
  protected unit = signal<'kg' | 'lbs'>(this.weightService.settings().unit);
  protected saved = signal(false);
  protected error = signal('');

  protected goalWeight = signal<number | null>(this.weightService.settings().goalWeight);

  get weightInput(): number | null { return this.weight(); }
  set weightInput(v: number | null) { this.weight.set(v); }

  get dateInput(): string { return this.date(); }
  set dateInput(v: string) { this.date.set(v); }

  get noteInput(): string { return this.note(); }
  set noteInput(v: string) { this.note.set(v); }

  get unitInput(): 'kg' | 'lbs' { return this.unit(); }
  set unitInput(v: 'kg' | 'lbs') { this.unit.set(v); }

  get goalWeightInput(): number | null { return this.goalWeight(); }
  set goalWeightInput(v: number | null) { this.goalWeight.set(v); }

  protected submit(): void {
    const w = this.weight();
    if (!w || w <= 0 || w > 500) {
      this.error.set('Please enter a valid weight (1-500).');
      return;
    }
    this.error.set('');

    this.weightService.addEntry({
      date: this.date(),
      weight: w,
      unit: this.unit(),
      note: this.note().trim() || undefined,
    });

    if (this.goalWeight() !== this.weightService.settings().goalWeight) {
      this.weightService.updateSettings({ goalWeight: this.goalWeight(), unit: this.unit() });
    } else {
      this.weightService.updateSettings({ unit: this.unit() });
    }

    this.saved.set(true);
    setTimeout(() => this.router.navigate(['/dashboard']), 800);
  }
}
