import { Component, inject, computed, ElementRef, ViewChild, AfterViewInit, effect, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WeightService } from '../../services/weight';
import { WeightEntry } from '../../models/weight-entry';

export { ChartComponent };

type Period = '7d' | '30d' | '90d' | 'all';

interface TrendResult {
  slope: number;     // kg per day
  intercept: number; // kg at day offset 0 (first entry date)
}

@Component({
  selector: 'app-chart',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './chart.html',
  styleUrl: './chart.scss',
})
class ChartComponent implements AfterViewInit {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly weightService = inject(WeightService);
  protected readonly allEntries = this.weightService.entries;
  protected readonly stats = this.weightService.stats;
  protected selectedPeriod: Period = '30d';
  protected showBmi = signal(false);
  protected readonly periods: { value: Period; label: string }[] = [
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: 'all', label: 'All' },
  ];

  protected readonly heightM = computed<number | null>(() => {
    const h = this.weightService.settings().height;
    return h != null && h > 0 ? h / 100 : null;
  });

  protected filteredEntries = computed(() => {
    const entries = this.allEntries();
    if (this.selectedPeriod === 'all') return entries;
    const days = this.selectedPeriod === '7d' ? 7 : this.selectedPeriod === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return entries.filter(e => e.date >= cutoffStr);
  });

  protected readonly trendLine = computed<TrendResult | null>(() =>
    this.computeTrend(this.filteredEntries())
  );

  /** Day offset from first filtered entry at which the trend crosses the goal. */
  private readonly targetDayOff = computed<number | null>(() => {
    const trend = this.trendLine();
    const goal = this.stats().goalWeight;
    const entries = this.filteredEntries();
    if (!trend || goal == null || entries.length < 2 || trend.slope === 0) return null;

    const d = (goal - trend.intercept) / trend.slope;
    if (!isFinite(d) || d < 0) return null;

    const firstMs = new Date(entries[0].date + 'T00:00:00').getTime();
    const lastMs  = new Date(entries[entries.length - 1].date + 'T00:00:00').getTime();
    const lastDayOffset = (lastMs - firstMs) / 86400000;

    // Only show projection that is ahead of the last entry and within 5 years
    if (d <= lastDayOffset || d > lastDayOffset + 365 * 5) return null;
    return d;
  });

  protected readonly goalHitDate = computed<Date | null>(() => {
    const dayOff = this.targetDayOff();
    const entries = this.filteredEntries();
    if (dayOff == null || entries.length < 2) return null;
    const firstMs = new Date(entries[0].date + 'T00:00:00').getTime();
    return new Date(firstMs + dayOff * 86400000);
  });

  protected readonly daysLeft = computed<number | null>(() => {
    const target = this.goalHitDate();
    if (!target) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  });

  /** BMI computed from the latest entry weight and user height. */
  protected readonly currentBmi = computed<number | null>(() => {
    const hM = this.heightM();
    const current = this.stats().current;
    if (hM == null || current == null) return null;
    return Math.round((current / (hM * hM)) * 10) / 10;
  });

  private initialized = false;

  constructor() {
    effect(() => {
      const _ = this.allEntries();
      if (this.initialized) {
        setTimeout(() => this.drawChart(), 10);
      }
    });
  }

  ngAfterViewInit(): void {
    this.initialized = true;
    this.drawChart();
  }

  protected selectPeriod(period: Period): void {
    this.selectedPeriod = period;
    setTimeout(() => this.drawChart(), 10);
  }

  protected toggleBmi(): void {
    this.showBmi.set(!this.showBmi());
    setTimeout(() => this.drawChart(), 10);
  }

  /** BMI = weight / heightM². Returns null when heightM is null. */
  protected computeBmi(weight: number, heightM: number): number {
    return weight / (heightM * heightM);
  }

  private computeTrend(entries: WeightEntry[]): TrendResult | null {
    if (entries.length < 2) return null;
    const firstMs = new Date(entries[0].date + 'T00:00:00').getTime();
    const xs = entries.map(e => (new Date(e.date + 'T00:00:00').getTime() - firstMs) / 86400000);
    const ys = entries.map(e => e.weight);
    const n = xs.length;
    const sumX  = xs.reduce((a, b) => a + b, 0);
    const sumY  = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const sumX2 = xs.reduce((a, x) => a + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    return {
      slope:     (n * sumXY - sumX * sumY) / denom,
      intercept: (sumY - (n * sumXY - sumX * sumY) / denom * sumX) / n,
    };
  }

  protected drawChart(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const entries = this.filteredEntries();
    const heightM = this.heightM();
    const drawBmi = this.showBmi() && heightM !== null;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const pad = { top: 24, right: drawBmi ? 50 : 20, bottom: 40, left: 50 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top  - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    if (entries.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Not enough data to display chart', W / 2, H / 2);
      return;
    }

    // ── Day-based x axis ───────────────────────────────────────────────────
    const firstMs      = new Date(entries[0].date + 'T00:00:00').getTime();
    const lastMs       = new Date(entries[entries.length - 1].date + 'T00:00:00').getTime();
    const lastDayOff   = (lastMs - firstMs) / 86400000;
    const targetDayOff = this.targetDayOff();

    // Extend x domain to show projection, capped at 1 year ahead of last entry
    const xDomain = targetDayOff !== null
      ? Math.min(targetDayOff, lastDayOff + 365)
      : Math.max(lastDayOff, 1);

    const entryDayOffset = (e: WeightEntry) =>
      (new Date(e.date + 'T00:00:00').getTime() - firstMs) / 86400000;
    const xScale = (dayOff: number) => pad.left + (dayOff / xDomain) * chartW;

    // ── Y range ────────────────────────────────────────────────────────────
    const weights = entries.map(e => e.weight);
    const minW  = Math.min(...weights);
    const maxW  = Math.max(...weights);
    const range = maxW - minW || 1;
    const yPad  = range * 0.15;
    const yMin  = minW - yPad;
    const yMax  = maxW + yPad;
    const yScale = (w: number) => pad.top + chartH - ((w - yMin) / (yMax - yMin)) * chartH;

    // ── Grid lines ─────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
    ctx.lineWidth = 1;
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y   = pad.top + (chartH / gridCount) * i;
      const val = yMax - ((yMax - yMin) / gridCount) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();
      ctx.fillStyle  = '#94a3b8';
      ctx.font       = '11px Inter, sans-serif';
      ctx.textAlign  = 'right';
      ctx.fillText(val.toFixed(1), pad.left - 8, y + 4);
    }

    // ── Goal line ──────────────────────────────────────────────────────────
    const goal = this.stats().goalWeight;
    if (goal != null && goal >= yMin && goal <= yMax) {
      const gy = yScale(goal);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(pad.left + chartW, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle  = '#10b981';
      ctx.font       = '10px Inter, sans-serif';
      ctx.textAlign  = 'left';
      ctx.fillText(`Goal ${goal}`, pad.left + 4, gy - 4);
    }

    // ── Trend line ─────────────────────────────────────────────────────────
    const trend = this.trendLine();
    if (trend) {
      const trendY0 = yScale(trend.intercept);
      const trendY1 = yScale(trend.intercept + trend.slope * xDomain);
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.8)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(xScale(0),       trendY0);
      ctx.lineTo(xScale(xDomain), trendY1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Target-hit vertical marker ─────────────────────────────────────────
    if (targetDayOff !== null && targetDayOff <= xDomain) {
      const tx = xScale(targetDayOff);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(tx, pad.top);
      ctx.lineTo(tx, pad.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      const targetDate = new Date(firstMs + targetDayOff * 86400000);
      const label = `${targetDate.getDate()}/${targetDate.getMonth() + 1}`;
      ctx.fillStyle  = '#10b981';
      ctx.font       = 'bold 10px Inter, sans-serif';
      ctx.textAlign  = tx > pad.left + chartW * 0.65 ? 'right' : 'left';
      ctx.fillText(`* ${label}`, tx + (ctx.textAlign === 'left' ? 4 : -4), pad.top + 14);
    }

    // ── Gradient fill ──────────────────────────────────────────────────────
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.35)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0)');

    ctx.beginPath();
    ctx.moveTo(xScale(entryDayOffset(entries[0])), yScale(entries[0].weight));
    for (let i = 1; i < entries.length; i++) {
      const x0 = xScale(entryDayOffset(entries[i - 1])), y0 = yScale(entries[i - 1].weight);
      const x1 = xScale(entryDayOffset(entries[i])),     y1 = yScale(entries[i].weight);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.lineTo(xScale(entryDayOffset(entries[entries.length - 1])), pad.top + chartH);
    ctx.lineTo(xScale(entryDayOffset(entries[0])),                  pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // ── Weight line ────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(xScale(entryDayOffset(entries[0])), yScale(entries[0].weight));
    for (let i = 1; i < entries.length; i++) {
      const x0 = xScale(entryDayOffset(entries[i - 1])), y0 = yScale(entries[i - 1].weight);
      const x1 = xScale(entryDayOffset(entries[i])),     y1 = yScale(entries[i].weight);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // ── Data points ────────────────────────────────────────────────────────
    entries.forEach(e => {
      const x = xScale(entryDayOffset(e));
      const y = yScale(e.weight);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle   = '#818cf8';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth   = 2;
      ctx.stroke();
    });

    // ── X axis labels ──────────────────────────────────────────────────────
    const labelStep = Math.max(1, Math.floor(entries.length / 5));
    ctx.fillStyle = '#94a3b8';
    ctx.font      = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    entries.forEach((e, i) => {
      if (i % labelStep === 0 || i === entries.length - 1) {
        const x    = xScale(entryDayOffset(e));
        const date = new Date(e.date + 'T00:00:00');
        ctx.fillText(`${date.getDate()}/${date.getMonth() + 1}`, x, pad.top + chartH + 16);
      }
    });

    // ── Unit label ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#94a3b8';
    ctx.font      = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('kg', 4, pad.top - 6);

    // ── BMI line (secondary axis) ──────────────────────────────────────────
    if (drawBmi && heightM !== null) {
      const bmiValues = entries.map(e => this.computeBmi(e.weight, heightM));
      const minBmi = Math.min(...bmiValues);
      const maxBmi = Math.max(...bmiValues);
      const bmiRange = maxBmi - minBmi || 1;
      const bmiYPad = bmiRange * 0.15;
      const bmiYMin = minBmi - bmiYPad;
      const bmiYMax = maxBmi + bmiYPad;
      const bmiYScale = (b: number) => pad.top + chartH - ((b - bmiYMin) / (bmiYMax - bmiYMin)) * chartH;

      // Right-side axis labels
      for (let i = 0; i <= gridCount; i++) {
        const val = bmiYMax - ((bmiYMax - bmiYMin) / gridCount) * i;
        const y   = pad.top + (chartH / gridCount) * i;
        ctx.fillStyle = '#f472b6';
        ctx.font      = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(val.toFixed(1), pad.left + chartW + 4, y + 4);
      }

      // BMI unit label
      ctx.fillStyle = '#f472b6';
      ctx.font      = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('BMI', pad.left + chartW + pad.right - 2, pad.top - 6);

      // BMI smooth line
      ctx.beginPath();
      ctx.moveTo(xScale(entryDayOffset(entries[0])), bmiYScale(bmiValues[0]));
      for (let i = 1; i < entries.length; i++) {
        const x0  = xScale(entryDayOffset(entries[i - 1]));
        const y0  = bmiYScale(bmiValues[i - 1]);
        const x1  = xScale(entryDayOffset(entries[i]));
        const y1  = bmiYScale(bmiValues[i]);
        const cpx = (x0 + x1) / 2;
        ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
      }
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.stroke();

      // BMI data points
      entries.forEach((e, i) => {
        const x = xScale(entryDayOffset(e));
        const y = bmiYScale(bmiValues[i]);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle   = '#f472b6';
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      });
    }
  }
}
