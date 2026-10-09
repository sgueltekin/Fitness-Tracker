import type { Ymd } from '../dates'
import type { Category, Sport } from '../domain'
import type { WorkoutSummary } from './common'

// Data contracts for the Activities list and the workout detail page. Owned by the Activities slice.
export interface ActivitiesQuery {
  sport?: Sport | 'all'
  /**
   * Free text, matched case- and accent-insensitively as one phrase against the workout's
   * displayed name, its type label ('Long run') and its date as shown ('8 Oct 2026').
   */
  search?: string
  /** Page size; omit for everything. */
  limit?: number
  offset?: number
}

export interface ActivitiesData {
  /** One page of the matches, newest first. */
  rows: WorkoutSummary[]
  /** Number of workouts matching sport and search, across all pages. */
  total: number
  /** Sums over every match, not only this page. Distance counts workouts that have one. */
  totalDistanceM: number
  totalDurationS: number
  /** Number of workouts in the database, ignoring the filters. */
  allCount: number
  /** Date of the earliest workout in the database. */
  firstDate: Ymd | null
  /** Sports that occur in the database, for the filter control. */
  sports: Sport[]
}

/** One lap or one kilometre split. */
export interface WorkoutSegment {
  /** 1-based position. */
  idx: number
  distanceM: number | null
  durationS: number
  /** Seconds per km; null when the segment is too short to have a meaningful pace. */
  paceSPerKm: number | null
  avgHr: number | null
}

export interface HrZone {
  /** 1 to 5. */
  zone: number
  /** Lower bound; null for the lowest zone. */
  minBpm: number | null
  /** Upper bound; null for the highest zone. */
  maxBpm: number | null
  seconds: number
}

/**
 * Time series resampled onto one grid: value i belongs to elapsed second i * stepS.
 * A series is null when nothing was recorded; inside a series, null marks a gap.
 */
export interface WorkoutSeries {
  stepS: number
  hr: (number | null)[] | null
  powerW: (number | null)[] | null
  elevationM: (number | null)[] | null
}

export interface WorkoutDetail {
  summary: WorkoutSummary
  /** App or device that wrote the workout into Health. */
  source: string
  indoor: boolean
  /** Typed in by hand rather than recorded. */
  userEntered: boolean
  /** Start to end, including pauses. `summary.durationS` is the active time. */
  elapsedS: number

  /** Only runs can be re-typed. */
  categoryEditable: boolean
  /** True when the category was set by hand. */
  categoryOverridden: boolean
  /** What the title-based detection says, i.e. what a reset goes back to. */
  autoCategory: Category

  energyKcal: number | null
  minHr: number | null
  maxHr: number | null
  avgPowerW: number | null
  avgStrideM: number | null
  avgGctMs: number | null
  avgVertOscCm: number | null
  stepCount: number | null
  /** Steps per minute of active time. */
  cadenceSpm: number | null
  elevationGainM: number | null
  /** Apple effort score, 1 to 10. */
  effort: number | null
  /** Fastest continuous kilometre inside the workout, in seconds. */
  bestKmS: number | null

  /** As recorded by the source app; empty when it wrote none. */
  laps: WorkoutSegment[]
  /** Per kilometre; the last one may be partial. */
  splits: WorkoutSegment[]
  /** Empty when Apple computed no zones. */
  zones: HrZone[]
  /** [lon, lat] pairs; empty without GPS. */
  route: [number, number][]
  series: WorkoutSeries
}
