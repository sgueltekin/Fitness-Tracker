import type { Sport } from '../domain'

// Data contracts for the Activities list and the workout detail page. Owned by the Activities slice.
export interface ActivitiesQuery {
  sport?: Sport | 'all'
  /** Free-text match on the title. */
  search?: string
  limit?: number
  offset?: number
}

export interface ActivitiesData {
  /** Placeholder until the slice is built. */
  ready: false
}

export interface WorkoutDetail {
  id: number
}
