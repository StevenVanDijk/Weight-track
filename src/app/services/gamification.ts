import { Injectable, signal, computed, inject } from '@angular/core';
import {
  Achievement, AchievementId, GamificationState,
  ALL_ACHIEVEMENTS, LEVELS, LevelInfo,
} from '../models/achievement';
import { WeightService } from './weight';
import { DbService } from '../db';

const STORAGE_KEY = 'weight_gamification';

@Injectable({ providedIn: 'root' })
export class GamificationService {
  private readonly weightService = inject(WeightService);
  private readonly db = inject(DbService);
  private _state = signal<GamificationState>(this.loadState());

  readonly state = this._state.asReadonly();

  readonly achievements = computed<Achievement[]>(() => {
    const unlocked = new Set(this._state().unlockedAchievements);
    return ALL_ACHIEVEMENTS.map(a => ({
      ...a,
      unlocked: unlocked.has(a.id),
    }));
  });

  readonly levelInfo = computed<LevelInfo>(() => {
    const xp = this._state().xp;
    return [...LEVELS].reverse().find(l => xp >= l.minXp) ?? LEVELS[0];
  });

  readonly nextLevelInfo = computed<LevelInfo | null>(() => {
    const current = this.levelInfo();
    const idx = LEVELS.findIndex(l => l.level === current.level);
    return idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
  });

  readonly xpProgress = computed<number>(() => {
    const current = this.levelInfo();
    const next = this.nextLevelInfo();
    if (!next) return 100;
    const xp = this._state().xp;
    return Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100);
  });

  /** Call this whenever a new entry is added. Returns newly unlocked achievements. */
  onEntryAdded(): Achievement[] {
    const entries = this.weightService.entries();
    const stats = this.weightService.stats();
    const state = this._state();

    // --- Streak ---
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    let streak = state.currentStreak;
    let lastLog = state.lastLogDate;

    if (lastLog === today) {
      // already logged today — no change
    } else if (lastLog === yesterday) {
      streak += 1;
      lastLog = today;
    } else {
      streak = 1;
      lastLog = today;
    }

    // --- Base XP per entry ---
    let earnedXp = 10 + Math.min(streak - 1, 5) * 2; // +2 per streak day, capped at +10 bonus

    // --- Check achievements ---
    const newlyUnlocked: AchievementId[] = [];
    const alreadyUnlocked = new Set(state.unlockedAchievements);

    const check = (id: AchievementId, condition: boolean) => {
      if (condition && !alreadyUnlocked.has(id)) {
        newlyUnlocked.push(id);
        alreadyUnlocked.add(id);
        const achXp = ALL_ACHIEVEMENTS.find(a => a.id === id)?.xp ?? 0;
        earnedXp += achXp;
      }
    };

    check('first_entry',  entries.length >= 1);
    check('entries_5',    entries.length >= 5);
    check('entries_20',   entries.length >= 20);
    check('entries_100',  entries.length >= 100);
    check('streak_3',     streak >= 3);
    check('streak_7',     streak >= 7);
    check('streak_14',    streak >= 14);
    check('streak_30',    streak >= 30);

    // Weight-loss achievements (toward goal)
    if (stats.startWeight && stats.current && stats.goalWeight) {
      const isLosing = stats.goalWeight < stats.startWeight;
      const change = isLosing
        ? stats.startWeight - stats.current
        : stats.current - stats.startWeight;
      check('lost_1',  change >= 1);
      check('lost_5',  change >= 5);
      check('lost_10', change >= 10);

      if (stats.totalChange !== null) {
        const total = Math.abs(stats.startWeight - stats.goalWeight);
        const done = Math.abs(stats.current - stats.startWeight);
        const pct = total > 0 ? (done / total) * 100 : 0;
        check('goal_50pct',   pct >= 50);
        check('goal_reached', isLosing ? stats.current <= stats.goalWeight : stats.current >= stats.goalWeight);
      }
    }

    // --- Level up ---
    const oldLevel = ([...LEVELS].reverse().find(l => state.xp >= l.minXp) ?? LEVELS[0]).level;
    const newXp = state.xp + earnedXp;
    const newLevel = ([...LEVELS].reverse().find(l => newXp >= l.minXp) ?? LEVELS[0]).level;

    if (newLevel > oldLevel) {
      const levelAchId = `level_${newLevel}` as AchievementId;
      if (!alreadyUnlocked.has(levelAchId)) {
        newlyUnlocked.push(levelAchId);
        alreadyUnlocked.add(levelAchId);
      }
    }

    const newState: GamificationState = {
      xp: newXp,
      level: newLevel,
      currentStreak: streak,
      longestStreak: Math.max(state.longestStreak, streak),
      lastLogDate: lastLog,
      unlockedAchievements: [...alreadyUnlocked],
      newlyUnlocked,
    };
    this._state.set(newState);
    this.saveState();

    return newlyUnlocked
      .map(id => ALL_ACHIEVEMENTS.find(a => a.id === id)!)
      .filter(Boolean);
  }

  clearNewlyUnlocked(): void {
    this._state.set({ ...this._state(), newlyUnlocked: [] });
    this.saveState();
  }

  /** Called by APP_INITIALIZER. If localStorage was evicted, restores from IndexedDB. */
  async restoreFromDb(): Promise<void> {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const raw = await this.db.read(STORAGE_KEY);
    if (raw && typeof raw === 'object') {
      const s = raw as GamificationState;
      this._state.set(s);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
  }

  private loadState(): GamificationState {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : this.defaultState();
    } catch {
      return this.defaultState();
    }
  }

  private saveState(): void {
    const data = this._state();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    this.db.write(STORAGE_KEY, data).catch(() => {}); // durable backup, fire-and-forget
  }

  private defaultState(): GamificationState {
    return {
      xp: 0, level: 1, currentStreak: 0, longestStreak: 0,
      lastLogDate: null, unlockedAchievements: [], newlyUnlocked: [],
    };
  }
}
