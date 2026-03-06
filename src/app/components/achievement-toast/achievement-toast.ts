import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { GamificationService } from '../../services/gamification';
import { Achievement } from '../../models/achievement';

export { AchievementToastComponent };

@Component({
  selector: 'app-achievement-toast',
  imports: [],
  templateUrl: './achievement-toast.html',
  styleUrl: './achievement-toast.scss',
})
class AchievementToastComponent implements OnInit, OnDestroy {
  private readonly gam = inject(GamificationService);
  protected readonly queue = signal<Achievement[]>([]);
  protected readonly current = computed(() => this.queue()[0] ?? null);
  protected visible = signal(false);

  private interval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Poll for newly unlocked achievements
    this.interval = setInterval(() => this.check(), 500);
  }

  ngOnDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private check(): void {
    const newIds = this.gam.state().newlyUnlocked;
    if (newIds.length === 0) return;

    const newAchs = this.gam.achievements().filter(a => newIds.includes(a.id as any));
    this.gam.clearNewlyUnlocked();

    this.queue.set([...this.queue(), ...newAchs]);
    if (!this.visible()) this.showNext();
  }

  private showNext(): void {
    if (this.queue().length === 0) return;
    this.visible.set(true);
    setTimeout(() => {
      this.visible.set(false);
      setTimeout(() => {
        this.queue.update(q => q.slice(1));
        if (this.queue().length > 0) this.showNext();
      }, 400);
    }, 3500);
  }
}
