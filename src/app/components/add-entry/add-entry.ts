import { Component, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { WeightService } from '../../services/weight';
import { GamificationService } from '../../services/gamification';
import { GoogleFitService } from '../../services/google-fit';
import { BloodPressureService } from '../../services/blood-pressure';

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
  private readonly gam = inject(GamificationService);
  private readonly googleFit = inject(GoogleFitService);
  protected readonly bpService = inject(BloodPressureService);

  protected mode = signal<'weight' | 'bp'>('weight');

  // Weight fields
  protected weight = signal<number | null>(null);
  protected date = signal(new Date().toISOString().split('T')[0]);
  protected note = signal('');
  protected saved = signal(false);
  protected error = signal('');
  protected goalWeight = signal<number | null>(this.weightService.settings().goalWeight);
  protected height = signal<number | null>(this.weightService.settings().height);

  // BP fields
  protected systolic = signal<number | null>(null);
  protected diastolic = signal<number | null>(null);
  protected bpDate = signal(new Date().toISOString().split('T')[0]);
  protected bpNote = signal('');
  protected bpSaved = signal(false);
  protected bpError = signal('');
  protected targetSystolic = signal<number | null>(this.bpService.settings().targetSystolic);
  protected targetDiastolic = signal<number | null>(this.bpService.settings().targetDiastolic);

  /** Weight of the most recent stored entry, or null if none. */
  protected readonly lastWeight = computed<number | null>(() => {
    const entries = this.weightService.entries();
    return entries.length > 0 ? entries[entries.length - 1].weight : null;
  });

  /** Slider bounds: last weight ±1 kg, rounded to 1 decimal. */
  protected readonly sliderMin = computed<number>(() =>
    Math.round(((this.lastWeight() ?? 80) - 1) * 10) / 10
  );

  protected readonly sliderMax = computed<number>(() =>
    Math.round(((this.lastWeight() ?? 80) + 1) * 10) / 10
  );

  // Weight getters/setters
  get weightInput(): number | null { return this.weight(); }
  set weightInput(v: number | null) { this.weight.set(v); }

  get sliderValue(): number { return this.weight() ?? this.lastWeight() ?? 80; }
  set sliderValue(v: number) { this.weight.set(Math.round(v * 10) / 10); }

  get dateInput(): string { return this.date(); }
  set dateInput(v: string) { this.date.set(v); }

  get noteInput(): string { return this.note(); }
  set noteInput(v: string) { this.note.set(v); }

  get goalWeightInput(): number | null { return this.goalWeight(); }
  set goalWeightInput(v: number | null) { this.goalWeight.set(v); }

  get heightInput(): number | null { return this.height(); }
  set heightInput(v: number | null) { this.height.set(v); }

  // BP getters/setters
  get systolicInput(): number | null { return this.systolic(); }
  set systolicInput(v: number | null) { this.systolic.set(v); }

  get diastolicInput(): number | null { return this.diastolic(); }
  set diastolicInput(v: number | null) { this.diastolic.set(v); }

  get bpDateInput(): string { return this.bpDate(); }
  set bpDateInput(v: string) { this.bpDate.set(v); }

  get bpNoteInput(): string { return this.bpNote(); }
  set bpNoteInput(v: string) { this.bpNote.set(v); }

  get targetSystolicInput(): number | null { return this.targetSystolic(); }
  set targetSystolicInput(v: number | null) { this.targetSystolic.set(v); }

  get targetDiastolicInput(): number | null { return this.targetDiastolic(); }
  set targetDiastolicInput(v: number | null) { this.targetDiastolic.set(v); }

  protected setMode(m: 'weight' | 'bp'): void {
    this.mode.set(m);
  }

  protected submit(): void {
    if (this.mode() === 'bp') {
      this.submitBp();
    } else {
      this.submitWeight();
    }
  }

  private submitWeight(): void {
    const w = this.weight();
    if (!w || w <= 0 || w > 500) {
      this.error.set('Please enter a valid weight (1–500 kg).');
      return;
    }
    this.error.set('');

    const date = this.date();
    this.weightService.addEntry({
      date,
      weight: w,
      note: this.note().trim() || undefined,
    });

    // Auto-sync to Google Fit if connected (fire-and-forget, silent on failure)
    const newEntry = this.weightService.entries().find(e => e.date === date);
    if (newEntry) {
      this.googleFit.syncEntry(newEntry);
    }

    const settings = this.weightService.settings();
    if (this.goalWeight() !== settings.goalWeight || this.height() !== settings.height) {
      this.weightService.updateSettings({ goalWeight: this.goalWeight(), height: this.height() });
    }

    this.gam.onEntryAdded();

    this.saved.set(true);
    setTimeout(() => this.router.navigate(['/dashboard']), 800);
  }

  private submitBp(): void {
    const sys = this.systolic();
    const dia = this.diastolic();

    if (!sys || sys < 60 || sys > 250) {
      this.bpError.set('Please enter a valid systolic pressure (60–250 mmHg).');
      return;
    }
    if (!dia || dia < 30 || dia > 150) {
      this.bpError.set('Please enter a valid diastolic pressure (30–150 mmHg).');
      return;
    }
    if (dia >= sys) {
      this.bpError.set('Diastolic must be less than systolic pressure.');
      return;
    }
    this.bpError.set('');

    const bpDate = this.bpDate();
    this.bpService.addEntry({
      date: bpDate,
      systolic: sys,
      diastolic: dia,
      note: this.bpNote().trim() || undefined,
    });

    // Auto-sync to Google Fit if connected (fire-and-forget, silent on failure)
    const newBpEntry = this.bpService.entries().find(e => e.date === bpDate);
    if (newBpEntry) {
      this.googleFit.syncBpEntry(newBpEntry);
    }

    const bpSettings = this.bpService.settings();
    if (this.targetSystolic() !== bpSettings.targetSystolic || this.targetDiastolic() !== bpSettings.targetDiastolic) {
      this.bpService.updateSettings({ targetSystolic: this.targetSystolic(), targetDiastolic: this.targetDiastolic() });
    }

    this.bpSaved.set(true);
    setTimeout(() => this.router.navigate(['/dashboard']), 800);
  }
}
