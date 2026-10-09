import type { RangeKey } from './dates'
import type { RunCategory } from './domain'
import type { AppStatus, ImportSummary } from './api/status'
import type { OverviewData } from './api/overview'
import type { RunningData } from './api/running'
import type { ActivitiesData, ActivitiesQuery, WorkoutDetail } from './api/activities'
import type { RoutesData } from './api/routes'
import type { GymData } from './api/gym'
import type { HealthData } from './api/health'

/**
 * Everything the renderer can ask the main process for.
 * Each method is one IPC round trip; results must be structured-cloneable.
 */
export interface Api {
  getStatus(): Promise<AppStatus>
  /** Imports an Apple Health export zip. Without a path, opens a file picker; resolves null if cancelled. */
  importExport(zipPath?: string): Promise<ImportSummary | null>

  getOverview(range: RangeKey): Promise<OverviewData>
  getRunning(range: RangeKey): Promise<RunningData>
  getActivities(query: ActivitiesQuery): Promise<ActivitiesData>
  getWorkout(id: number): Promise<WorkoutDetail | null>
  /** Sets a manual run category, or clears it with null. */
  setWorkoutCategory(id: number, category: RunCategory | null): Promise<void>
  getRoutes(range: RangeKey): Promise<RoutesData>
  getGym(range: RangeKey): Promise<GymData>
  getHealth(range: RangeKey): Promise<HealthData>
}

export type ApiMethod = keyof Api

export const API_METHODS: ApiMethod[] = [
  'getStatus',
  'importExport',
  'getOverview',
  'getRunning',
  'getActivities',
  'getWorkout',
  'setWorkoutCategory',
  'getRoutes',
  'getGym',
  'getHealth'
]

/** Channel the main process uses to push import progress to the renderer. */
export const IMPORT_PROGRESS_CHANNEL = 'import-progress'
