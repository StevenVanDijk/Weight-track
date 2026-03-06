import { Component, inject, computed } from '@angular/core';
import { GamificationService } from '../../services/gamification';
import { LEVELS } from '../../models/achievement';

export { AchievementsComponent };

@Component({
  selector: 'app-achievements',
  imports: [],
  templateUrl: './achievements.html',
  styleUrl: './achievements.scss',
})
class AchievementsComponent {
  protected readonly gam = inject(GamificationService);
  protected readonly achievements = this.gam.achievements;
  protected readonly state = this.gam.state;
  protected readonly levelInfo = this.gam.levelInfo;
  protected readonly nextLevel = this.gam.nextLevelInfo;
  protected readonly xpProgress = this.gam.xpProgress;
  protected readonly levels = LEVELS;

  protected readonly unlocked = computed(() => this.achievements().filter(a => a.unlocked));
  protected readonly locked   = computed(() => this.achievements().filter(a => !a.unlocked));

  protected rarityLabel: Record<string, string> = {
    common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary',
  };
}
