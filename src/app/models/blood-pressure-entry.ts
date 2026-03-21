export interface BloodPressureEntry {
  id: string;
  date: string; // ISO date YYYY-MM-DD
  systolic: number;
  diastolic: number;
  note?: string;
}

export interface BloodPressureStats {
  latest: { systolic: number; diastolic: number } | null;
  avgSystolic: number | null;
  avgDiastolic: number | null;
  minSystolic: number | null;
  maxSystolic: number | null;
  minDiastolic: number | null;
  maxDiastolic: number | null;
}
