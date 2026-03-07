import { TestBed } from '@angular/core/testing';
import { GamificationService } from './gamification';
import { WeightService } from './weight';
import { LEVELS, ALL_ACHIEVEMENTS } from '../models/achievement';

const GAM_KEY = 'weight_gamification';

describe('GamificationService', () => {
  let gam: GamificationService;
  let weight: WeightService;

  // Helper: add N entries on consecutive calendar days ending today
  function addEntries(count: number, startWeight = 90, delta = -0.5) {
    for (let i = 0; i < count; i++) {
      const d = new Date(Date.now() - (count - 1 - i) * 86400000);
      weight.addEntry({ date: d.toISOString().split('T')[0], weight: startWeight + i * delta });
    }
  }

  // Helper: simulate N days of logging by patching lastLogDate backward
  function simulateStreak(days: number) {
    // Set lastLogDate to yesterday so that logging today increments the streak to `days`
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const state = {
      xp: 0, level: 1, newlyUnlocked: [], unlockedAchievements: [],
      lastLogDate: yesterday,
      currentStreak: days - 1,
      longestStreak: days - 1,
    };
    localStorage.setItem(GAM_KEY, JSON.stringify(state));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    gam = TestBed.inject(GamificationService);
    weight = TestBed.inject(WeightService);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    gam = TestBed.inject(GamificationService);
    weight = TestBed.inject(WeightService);
  });

  afterEach(() => localStorage.clear());

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts at level 1 with 0 XP', () => {
      expect(gam.state().xp).toBe(0);
      expect(gam.state().level).toBe(1);
    });

    it('starts with zero streak', () => {
      expect(gam.state().currentStreak).toBe(0);
      expect(gam.state().longestStreak).toBe(0);
    });

    it('starts with no unlocked achievements', () => {
      expect(gam.state().unlockedAchievements).toEqual([]);
    });

    it('loads persisted state from localStorage', () => {
      const saved = { xp: 200, level: 2, currentStreak: 5, longestStreak: 7, lastLogDate: '2024-01-10', unlockedAchievements: ['first_entry'], newlyUnlocked: [] };
      localStorage.setItem(GAM_KEY, JSON.stringify(saved));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(GamificationService);
      expect(fresh.state().xp).toBe(200);
      expect(fresh.state().currentStreak).toBe(5);
    });

    it('falls back to defaults on invalid localStorage data', () => {
      localStorage.setItem(GAM_KEY, 'bad-json');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(GamificationService);
      expect(fresh.state().xp).toBe(0);
    });
  });

  // ─── XP ────────────────────────────────────────────────────────────────────

  describe('XP', () => {
    it('awards 10 XP for the first entry (streak=1, no bonus)', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      // 10 base + 20 first_entry achievement XP = 30
      expect(gam.state().xp).toBeGreaterThanOrEqual(10);
    });

    it('awards streak bonus XP (+2 per streak day, max +10)', () => {
      simulateStreak(3);
      const before = gam.state().xp;
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      const earned = gam.state().xp - before;
      // streak=3 → bonus = min(2,5)*2 = 4 → base = 10+4 = 14 (plus any ach XP)
      expect(earned).toBeGreaterThanOrEqual(14);
    });

    it('caps streak XP bonus at +10 (streak >= 6)', () => {
      simulateStreak(6);
      const before = gam.state().xp;
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      const earned = gam.state().xp - before;
      // base = 10 + min(5,5)*2 = 20 (plus any ach XP)
      expect(earned).toBeGreaterThanOrEqual(20);
    });

    it('persists XP to localStorage', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      const stored = JSON.parse(localStorage.getItem(GAM_KEY)!);
      expect(stored.xp).toBeGreaterThan(0);
    });
  });

  // ─── Levels ────────────────────────────────────────────────────────────────

  describe('levelInfo', () => {
    it('returns Level 1 at 0 XP', () => {
      expect(gam.levelInfo().level).toBe(1);
      expect(gam.levelInfo().title).toBe('Beginner');
    });

    it('returns Level 2 when XP >= 150', () => {
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 150, level: 2, currentStreak: 0, longestStreak: 0, lastLogDate: null, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(GamificationService);
      expect(fresh.levelInfo().level).toBe(2);
    });

    it('returns Level 5 at max XP (1500+)', () => {
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 1500, level: 5, currentStreak: 0, longestStreak: 0, lastLogDate: null, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(GamificationService);
      expect(fresh.levelInfo().level).toBe(5);
    });

    it('nextLevelInfo is null at max level', () => {
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 2000, level: 5, currentStreak: 0, longestStreak: 0, lastLogDate: null, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(GamificationService);
      expect(fresh.nextLevelInfo()).toBeNull();
    });

    it('xpProgress is 100 at max level', () => {
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 2000, level: 5, currentStreak: 0, longestStreak: 0, lastLogDate: null, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(GamificationService);
      expect(fresh.xpProgress()).toBe(100);
    });

    it('xpProgress is 0 at start of a level', () => {
      // At exactly level-2 threshold (150 XP), progress toward level 3 = 0%
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 150, level: 2, currentStreak: 0, longestStreak: 0, lastLogDate: null, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(GamificationService);
      expect(fresh.xpProgress()).toBe(0);
    });

    it('LEVELS array has 5 levels in ascending order', () => {
      expect(LEVELS.length).toBe(5);
      for (let i = 1; i < LEVELS.length; i++) {
        expect(LEVELS[i].minXp).toBeGreaterThan(LEVELS[i - 1].minXp);
      }
    });
  });

  // ─── Streaks ───────────────────────────────────────────────────────────────

  describe('streaks', () => {
    it('sets streak to 1 on first entry', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().currentStreak).toBe(1);
    });

    it('increments streak when logging on consecutive days', () => {
      simulateStreak(3); // sets lastLogDate to yesterday with streak=2
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().currentStreak).toBe(3);
    });

    it('resets streak to 1 when a day is missed', () => {
      // lastLogDate is 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 50, level: 1, currentStreak: 5, longestStreak: 5, lastLogDate: twoDaysAgo, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      gam = TestBed.inject(GamificationService);
      weight = TestBed.inject(WeightService);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().currentStreak).toBe(1);
    });

    it('does not increment streak when logging twice on the same day', () => {
      const today = new Date().toISOString().split('T')[0];
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 50, level: 1, currentStreak: 3, longestStreak: 3, lastLogDate: today, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      gam = TestBed.inject(GamificationService);
      weight = TestBed.inject(WeightService);
      weight.addEntry({ date: today, weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().currentStreak).toBe(3);
    });

    it('updates longestStreak when current exceeds it', () => {
      simulateStreak(10);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().longestStreak).toBe(10);
    });

    it('longestStreak is preserved after streak resets', () => {
      // Set a high longest streak, then reset
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 200, level: 2, currentStreak: 15, longestStreak: 15, lastLogDate: twoDaysAgo, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      gam = TestBed.inject(GamificationService);
      weight = TestBed.inject(WeightService);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().currentStreak).toBe(1);
      expect(gam.state().longestStreak).toBe(15);
    });
  });

  // ─── Achievements ──────────────────────────────────────────────────────────

  describe('entry count achievements', () => {
    it('unlocks first_entry on the first log', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('first_entry');
    });

    it('does not re-unlock first_entry on subsequent logs', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      const xpAfterFirst = gam.state().xp;
      weight.addEntry({ date: '2024-01-02', weight: 79 });
      gam.onEntryAdded();
      // second call: first_entry should not add XP again
      const delta = gam.state().xp - xpAfterFirst;
      expect(gam.state().unlockedAchievements.filter(a => a === 'first_entry').length).toBe(1);
      // XP gained should only be base (not first_entry bonus)
      expect(delta).toBeLessThan(30); // first_entry gives 20 XP
    });

    it('unlocks entries_5 on the 5th entry', () => {
      addEntries(5);
      for (let i = 0; i < 5; i++) gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('entries_5');
    });

    it('does not unlock entries_5 on only 4 entries', () => {
      addEntries(4);
      for (let i = 0; i < 4; i++) gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).not.toContain('entries_5');
    });

    it('unlocks entries_20 on the 20th entry', () => {
      addEntries(20);
      for (let i = 0; i < 20; i++) gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('entries_20');
    });

    it('unlocks entries_100 on the 100th entry', () => {
      addEntries(100);
      for (let i = 0; i < 100; i++) gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('entries_100');
    });
  });

  describe('streak achievements', () => {
    it('unlocks streak_3 on a 3-day streak', () => {
      simulateStreak(3);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('streak_3');
    });

    it('unlocks streak_7 on a 7-day streak', () => {
      simulateStreak(7);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('streak_7');
    });

    it('unlocks streak_14 on a 14-day streak', () => {
      simulateStreak(14);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('streak_14');
    });

    it('unlocks streak_30 on a 30-day streak', () => {
      simulateStreak(30);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).toContain('streak_30');
    });

    it('does not unlock streak_7 on a 6-day streak', () => {
      simulateStreak(6);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).not.toContain('streak_7');
    });
  });

  describe('weight-loss achievements', () => {
    function setupLossScenario(startKg: number, currentKg: number, goalKg: number) {
      // Add the start entry far in the past
      const old = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0];
      weight.addEntry({ date: old, weight: startKg });
      weight.updateSettings({ goalWeight: goalKg });
      // Add current entry (today)
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: currentKg });
      // Call onEntryAdded twice (once for old seed, once for current)
      gam.onEntryAdded();
      gam.onEntryAdded();
    }

    it('unlocks lost_1 when 1 kg has been lost toward goal', () => {
      setupLossScenario(90, 89, 70);
      expect(gam.state().unlockedAchievements).toContain('lost_1');
    });

    it('does not unlock lost_1 when weight has not dropped 1 kg', () => {
      setupLossScenario(90, 89.5, 70);
      expect(gam.state().unlockedAchievements).not.toContain('lost_1');
    });

    it('unlocks lost_5 when 5 kg lost', () => {
      setupLossScenario(90, 85, 70);
      expect(gam.state().unlockedAchievements).toContain('lost_5');
    });

    it('unlocks lost_10 when 10 kg lost', () => {
      setupLossScenario(90, 80, 70);
      expect(gam.state().unlockedAchievements).toContain('lost_10');
    });

    it('unlocks goal_50pct at 50% progress toward goal', () => {
      // start=90, goal=70, midpoint=80
      setupLossScenario(90, 80, 70);
      expect(gam.state().unlockedAchievements).toContain('goal_50pct');
    });

    it('does not unlock goal_50pct below 50% progress', () => {
      // start=90, goal=70, current=81 = 45% progress
      setupLossScenario(90, 81, 70);
      expect(gam.state().unlockedAchievements).not.toContain('goal_50pct');
    });

    it('unlocks goal_reached when current weight <= goal (weight loss)', () => {
      setupLossScenario(90, 70, 70);
      expect(gam.state().unlockedAchievements).toContain('goal_reached');
    });

    it('does not unlock goal_reached when above goal', () => {
      setupLossScenario(90, 71, 70);
      expect(gam.state().unlockedAchievements).not.toContain('goal_reached');
    });

    it('does not check weight achievements when no goal is set', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().unlockedAchievements).not.toContain('lost_1');
    });
  });

  describe('level-up achievements', () => {
    it('unlocks level_2 achievement when reaching level 2', () => {
      // Start just below level 2 (150 XP), next entry should push over
      localStorage.setItem(GAM_KEY, JSON.stringify({ xp: 130, level: 1, currentStreak: 0, longestStreak: 0, lastLogDate: null, unlockedAchievements: [], newlyUnlocked: [] }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      gam = TestBed.inject(GamificationService);
      weight = TestBed.inject(WeightService);
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded(); // +10 base + 20 first_entry = 160 → level 2
      expect(gam.state().unlockedAchievements).toContain('level_2');
    });
  });

  // ─── achievements computed ─────────────────────────────────────────────────

  describe('achievements computed signal', () => {
    it('returns all achievements with unlocked=false initially', () => {
      const all = gam.achievements();
      expect(all.every(a => !a.unlocked)).toBe(true);
    });

    it('marks the correct achievement as unlocked after earning it', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      const first = gam.achievements().find(a => a.id === 'first_entry');
      expect(first?.unlocked).toBe(true);
    });

    it('returns the same total count as ALL_ACHIEVEMENTS', () => {
      
      expect(gam.achievements().length).toBe(ALL_ACHIEVEMENTS.length);
    });
  });

  // ─── newlyUnlocked / clearNewlyUnlocked ────────────────────────────────────

  describe('newlyUnlocked', () => {
    it('populates newlyUnlocked when achievements are earned', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      expect(gam.state().newlyUnlocked).toContain('first_entry');
    });

    it('clearNewlyUnlocked empties the list', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      gam.onEntryAdded();
      gam.clearNewlyUnlocked();
      expect(gam.state().newlyUnlocked).toEqual([]);
    });

    it('onEntryAdded returns the newly unlocked Achievement objects', () => {
      weight.addEntry({ date: new Date().toISOString().split('T')[0], weight: 80 });
      const result = gam.onEntryAdded();
      expect(result.some(a => a.id === 'first_entry')).toBe(true);
    });
  });
});
