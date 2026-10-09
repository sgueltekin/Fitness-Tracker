import type { ActivitiesData, ActivitiesQuery, WorkoutDetail } from '@shared/api/activities'
import type { RunCategory } from '@shared/domain'
import type { Db } from '../db'

export function getActivities(_db: Db, _query: ActivitiesQuery): ActivitiesData {
  return { ready: false }
}

export function getWorkout(_db: Db, _id: number): WorkoutDetail | null {
  return null
}

export function setWorkoutCategory(_db: Db, _id: number, _category: RunCategory | null): void {}
