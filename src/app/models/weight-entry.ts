export interface WeightEntry {
  id: string;
  date: string; // ISO date string YYYY-MM-DD
  weight: number;
  note?: string;
}

export interface WeightStats {
  current: number | null;
  startWeight: number | null;
  goalWeight: number | null;
  minWeight: number | null;
  maxWeight: number | null;
  avgWeight: number | null;
  totalChange: number | null;
  weeklyChange: number | null;
}
