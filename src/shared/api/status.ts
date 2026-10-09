export interface ImportProgress {
  phase: 'reading' | 'processing' | 'writing' | 'done'
  /** 0..1 across the whole import. */
  fraction: number
  message: string
}

export interface ImportSummary {
  fileName: string
  /** Export timestamp from the file, as written by Health (e.g. '2026-10-09 11:35:04 +0200'). */
  exportDate: string | null
  /** Workouts in the database after the import. */
  workoutsTotal: number
  /** Workouts that were not in the database before. */
  workoutsNew: number
  /** Workouts in the export that were dropped as copies of another one. */
  duplicatesSkipped: number
  durationMs: number
}

export interface AppStatus {
  hasData: boolean
  workoutCount: number
  /** First and last workout date, YYYY-MM-DD. */
  firstDate: string | null
  lastDate: string | null
  lastImport: { importedAt: number; fileName: string; exportDate: string | null } | null
}
