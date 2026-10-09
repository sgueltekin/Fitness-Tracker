// Data contract for the Running page. Owned by the Running slice: shape it to what the page renders.
import type { Ymd } from '../dates'
import type { RunCategory } from '../domain'
import type { WorkoutSummary } from './common'

/** Column width of a time chart. Longer spans switch from weeks to months to quarters. */
export type Bucket = 'week' | 'month' | 'quarter'

/** A measure over the last 28 days and over the 28 days before them. Null when there was nothing to measure. */
export interface Compared {
  now: number | null
  before: number | null
}

export interface RunningRecent {
  /** Length of each comparison window in days; the current window ends today. */
  days: number
  /** Metres per week (window total divided by its number of weeks); 0 when there were no runs. */
  weeklyDistanceM: { now: number; before: number }
  /** Easy runs only, seconds per km: total time over total distance. */
  easyPaceSPerKm: Compared
  /** Easy runs with heart rate only, bpm, weighted by duration. */
  easyHr: Compared
  /** Easy runs in the current window, with or without heart rate. */
  easyRuns: number
}

export interface DistanceBucket {
  /** Monday of the week, or first day of the month or quarter. */
  start: Ymd
  runs: number
  /** Metres per run category; categories without runs are absent. */
  byCategory: Partial<Record<RunCategory, number>>
}

export interface BestEffort {
  /** One of BEST_EFFORT_DISTANCES. */
  distanceM: number
  /** Null fields mean no run has covered this distance yet. */
  durationS: number | null
  workoutId: number | null
  date: Ymd | null
}

export interface EasyTrendPoint {
  /** Monday of the week, or first day of the month or quarter. */
  start: Ymd
  /** Easy runs in the bucket. */
  runs: number
  /** Total time over total distance of those runs; null when the bucket has no easy run. */
  paceSPerKm: number | null
  /** Easy runs in the bucket that have heart rate. */
  hrRuns: number
  /** Duration-weighted average heart rate of those; null when none was recorded with a watch. */
  avgHr: number | null
}

export interface ZoneTotal {
  /** 1 to 5. */
  zone: number
  seconds: number
  /** Limits as stored with the latest run in the range; null at the open ends. */
  minBpm: number | null
  maxBpm: number | null
}

export interface RunningData {
  /** The range the page covers: Monday of its first week to today. */
  from: Ymd
  to: Ymd
  totals: { runs: number; distanceM: number; durationS: number }
  /** Rolling four-week comparison for the headline tiles; independent of the range. */
  recent: RunningRecent
  /** Longest run by distance in the range. */
  longest: WorkoutSummary | null
  /** Every bucket of the range, oldest first, including empty ones. */
  distance: { bucket: Bucket; buckets: DistanceBucket[] }
  /** All-time personal bests, one entry per BEST_EFFORT_DISTANCES in that order. */
  bests: BestEffort[]
  /**
   * Easy runs per bucket, from the first easy run in the range to today, including empty buckets.
   * Empty when the range has no easy run.
   */
  easyTrend: { bucket: Bucket; points: EasyTrendPoint[] }
  /** Time in heart-rate zones summed over the runs in the range that carry zone data. */
  zones: {
    /** Runs in the range that have zone data, out of `totals.runs`. */
    runsWithZones: number
    /** Zones 1 to 5; empty when no run in the range has zone data. */
    zones: ZoneTotal[]
  }
  /** Latest tempo, interval and long runs in the range, newest first. */
  keySessions: WorkoutSummary[]
}
