import { Component, inject, computed, ElementRef, ViewChild, AfterViewInit, effect } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { WeightService } from '../../services/weight';
import { WeightEntry } from '../../models/weight-entry';

export { ChartComponent };

type Period = '7d' | '30d' | '90d' | 'all';

@Component({
  selector: 'app-chart',
  imports: [DecimalPipe],
  templateUrl: './chart.html',
  styleUrl: './chart.scss',
})
class ChartComponent implements AfterViewInit {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly weightService = inject(WeightService);
  protected readonly allEntries = this.weightService.entries;
  protected readonly stats = this.weightService.stats;
  protected selectedPeriod: Period = '30d';
  protected readonly periods: { value: Period; label: string }[] = [
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: 'all', label: 'All' },
  ];

  protected filteredEntries = computed(() => {
    const entries = this.allEntries();
    if (this.selectedPeriod === 'all') return entries;
    const days = this.selectedPeriod === '7d' ? 7 : this.selectedPeriod === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return entries.filter(e => e.date >= cutoffStr);
  });

  private initialized = false;

  constructor() {
    effect(() => {
      // Re-draw when entries change
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

  protected drawChart(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const entries = this.filteredEntries();
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const pad = { top: 24, right: 20, bottom: 40, left: 50 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    // Clear
    ctx.clearRect(0, 0, W, H);

    if (entries.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Not enough data to display chart', W / 2, H / 2);
      return;
    }

    const weights = entries.map(e => e.weight);
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const range = maxW - minW || 1;
    const padding = range * 0.15;
    const yMin = minW - padding;
    const yMax = maxW + padding;

    const xScale = (i: number) => pad.left + (i / (entries.length - 1)) * chartW;
    const yScale = (w: number) => pad.top + chartH - ((w - yMin) / (yMax - yMin)) * chartH;

    // Grid lines
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
    ctx.lineWidth = 1;
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = pad.top + (chartH / gridCount) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();

      // Y axis labels
      const val = yMax - ((yMax - yMin) / gridCount) * i;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), pad.left - 8, y + 4);
    }

    // Goal line
    const goal = this.stats().goalWeight;
    if (goal && goal >= yMin && goal <= yMax) {
      const gy = yScale(goal);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(pad.left + chartW, gy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#10b981';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Goal ${goal}`, pad.left + 4, gy - 4);
    }

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.35)');
    gradient.addColorStop(1, 'rgba(79, 70, 229, 0)');

    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(entries[0].weight));
    for (let i = 1; i < entries.length; i++) {
      const x0 = xScale(i - 1), y0 = yScale(entries[i - 1].weight);
      const x1 = xScale(i), y1 = yScale(entries[i].weight);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.lineTo(xScale(entries.length - 1), pad.top + chartH);
    ctx.lineTo(xScale(0), pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(entries[0].weight));
    for (let i = 1; i < entries.length; i++) {
      const x0 = xScale(i - 1), y0 = yScale(entries[i - 1].weight);
      const x1 = xScale(i), y1 = yScale(entries[i].weight);
      const cpx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
    }
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Data points
    entries.forEach((e, i) => {
      const x = xScale(i);
      const y = yScale(e.weight);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#818cf8';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // X axis labels (show every Nth)
    const labelStep = Math.max(1, Math.floor(entries.length / 5));
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    entries.forEach((e, i) => {
      if (i % labelStep === 0 || i === entries.length - 1) {
        const x = xScale(i);
        const date = new Date(e.date + 'T00:00:00');
        const label = `${date.getDate()}/${date.getMonth() + 1}`;
        ctx.fillText(label, x, pad.top + chartH + 16);
      }
    });

    // Unit label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.stats().unit, 4, pad.top - 6);
  }
}
