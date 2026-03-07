export type AchievementId =
  | 'first_entry'
  | 'entries_5'
  | 'entries_20'
  | 'entries_100'
  | 'streak_3'
  | 'streak_7'
  | 'streak_14'
  | 'streak_30'
  | 'lost_1'
  | 'lost_5'
  | 'lost_10'
  | 'goal_50pct'
  | 'goal_reached'
  | 'level_2'
  | 'level_3'
  | 'level_4'
  | 'level_5';

export interface Achievement {
  id: AchievementId;
  title: string;
  description: string;
  icon: string; // Material icon name
  xp: number;
  unlocked: boolean;
  unlockedAt?: string; // ISO date string
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface GamificationState {
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastLogDate: string | null;
  unlockedAchievements: AchievementId[];
  newlyUnlocked: AchievementId[]; // cleared after shown
}

export interface LevelInfo {
  level: number;
  title: string;
  minXp: number;
  maxXp: number;
  color: string;
}

export const LEVELS: LevelInfo[] = [
  { level: 1, title: 'Beginner',   minXp: 0,    maxXp: 150,  color: '#94a3b8' },
  { level: 2, title: 'Tracker',    minXp: 150,  maxXp: 400,  color: '#10b981' },
  { level: 3, title: 'Consistent', minXp: 400,  maxXp: 800,  color: '#06b6d4' },
  { level: 4, title: 'Dedicated',  minXp: 800,  maxXp: 1500, color: '#818cf8' },
  { level: 5, title: 'Master',     minXp: 1500, maxXp: 1500, color: '#f59e0b' },
];

export const ALL_ACHIEVEMENTS: Achievement[] = [
  { id: 'first_entry',  title: 'First Step',      description: 'Log your first weight entry',               icon: 'flag',           xp: 20,  rarity: 'common',    unlocked: false },
  { id: 'entries_5',    title: 'Getting Started',  description: 'Log 5 weight entries',                      icon: 'directions_run', xp: 30,  rarity: 'common',    unlocked: false },
  { id: 'entries_20',   title: 'Data Nerd',        description: 'Log 20 weight entries',                     icon: 'bar_chart',      xp: 75,  rarity: 'rare',      unlocked: false },
  { id: 'entries_100',  title: 'Century Club',     description: 'Log 100 weight entries',                    icon: 'workspace_premium', xp: 200, rarity: 'legendary', unlocked: false },
  { id: 'streak_3',     title: 'On a Roll',        description: 'Log weight 3 days in a row',                icon: 'local_fire_department', xp: 30, rarity: 'common', unlocked: false },
  { id: 'streak_7',     title: 'Week Warrior',     description: 'Maintain a 7-day logging streak',           icon: 'bolt',           xp: 75,  rarity: 'rare',      unlocked: false },
  { id: 'streak_14',    title: 'Fortnight Fighter', description: 'Maintain a 14-day logging streak',         icon: 'whatshot',       xp: 150, rarity: 'epic',      unlocked: false },
  { id: 'streak_30',    title: 'Unstoppable',      description: 'Maintain a 30-day logging streak',          icon: 'military_tech',  xp: 300, rarity: 'legendary', unlocked: false },
  { id: 'lost_1',       title: 'First Milestone',  description: 'Lose 1 kg toward your goal',            icon: 'trending_down',  xp: 50,  rarity: 'common',    unlocked: false },
  { id: 'lost_5',       title: 'Making Progress',  description: 'Lose 5 kg toward your goal',            icon: 'moving',         xp: 100, rarity: 'rare',      unlocked: false },
  { id: 'lost_10',      title: 'Transformation',   description: 'Lose 10 kg toward your goal',           icon: 'emoji_events',   xp: 200, rarity: 'epic',      unlocked: false },
  { id: 'goal_50pct',   title: 'Halfway There',    description: 'Reach 50% of your weight goal',             icon: 'half_star',      xp: 100, rarity: 'rare',      unlocked: false },
  { id: 'goal_reached', title: 'Goal Crusher',     description: 'Reach your target weight!',                 icon: 'star',           xp: 500, rarity: 'legendary', unlocked: false },
  { id: 'level_2',      title: 'Level Up!',        description: 'Reach Level 2 — Tracker',                  icon: 'upgrade',        xp: 0,   rarity: 'common',    unlocked: false },
  { id: 'level_3',      title: 'Level Up!',        description: 'Reach Level 3 — Consistent',               icon: 'upgrade',        xp: 0,   rarity: 'rare',      unlocked: false },
  { id: 'level_4',      title: 'Level Up!',        description: 'Reach Level 4 — Dedicated',                icon: 'upgrade',        xp: 0,   rarity: 'epic',      unlocked: false },
  { id: 'level_5',      title: 'Mastery',          description: 'Reach Level 5 — Master',                   icon: 'military_tech',  xp: 0,   rarity: 'legendary', unlocked: false },
];
