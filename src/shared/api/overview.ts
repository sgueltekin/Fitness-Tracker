// Data contract for the Overview page. Owned by the Overview slice: shaped to what the page renders.
import type { RangeBounds, RangeKey, Ymd } from '../dates'
import type { Category } from '../domain'
import type { WorkoutSummary } from './common'

/** Column width of the charts: weeks, or months once the range is longer than a year. */
export type BucketUnit = 'week' | 'month'

/** One trailing 7-day window behind a headline tile. */
export interface OverviewWindow {
  from: Ymd
  to: Ymd
  /** Running distance in metres. */
  runDistanceM: number
  /** Duration of all workouts in seconds. */
  trainingS: number
  runs: number
  gymSessions: number
}

/** One column of the weekly (or monthly) charts. */
export interface OverviewBucket {
  /** Monday of the week, or the first day of the month. */
  start: Ymd
  /** True for the bucket that contains today. */
  current: boolean
  /** Workouts of any sport. */
  sessions: number
  /**
   * Seconds per training category (`TRAINING_CATEGORIES`). Sports outside that list
   * (swim, ride, walk) are counted under 'other'. Categories without time are absent.
   */
  seconds: Partial<Record<Category, number>>
  runs: number
  /** Metres run; null when the bucket has runs but none of them recorded a distance. */
  runDistanceM: number | null
  gymSessions: number
  /**
   * Training load: effort rating (1-10) times minutes, summed over rated workouts.
   * Null when the bucket has nothing that could carry a rating: it lies before the
   * first rated workout, or it has workouts and none of them is rated.
   */
  load: number | null
  /** Parts of `load` from runs and from gym sessions; the remainder is other sports. */
  loadRun: number
  loadGym: number
  /** Workouts with an effort rating. */
  ratedSessions: number
}

export interface OverviewMixRow {
  category: Category
  seconds: number
  sessions: number
}

/** One day with at least one workout. */
export interface OverviewDay {
  date: Ymd
  seconds: number
  sessions: number
  /** Distinct session types of the day, as recorded (not folded into 'other'). */
  categories: Category[]
}

export interface OverviewGym {
  sessions: number
  avgDurationS: number | null
  /** Mean of the sessions' average heart rate; null when no session in the range has one. */
  avgHr: number | null
  /** Sessions that have a heart rate. */
  hrSessions: number
}

export interface OverviewData {
  /** The server's "today"; the range and the 7-day windows end here. */
  today: Ymd
  /** The range this data was computed for. */
  rangeKey: RangeKey
  range: RangeBounds
  unit: BucketUnit
  /** Trailing 7-day windows, oldest first; the last one ends today. At least two, at most twelve. */
  windows: OverviewWindow[]
  /** Every week or month of the range, oldest first, including empty ones. */
  buckets: OverviewBucket[]
  /** Training time of the range per category, in `TRAINING_CATEGORIES` order, without empty rows. */
  mix: OverviewMixRow[]
  /** Daily totals for the calendar. Long ranges are cut to the most recent weeks (`capped`). */
  calendar: { from: Ymd; to: Ymd; weeks: number; capped: boolean; days: OverviewDay[] }
  gym: OverviewGym
  /** Date of the first workout with an effort rating, in any range; null when there is none. */
  effortSince: Ymd | null
  /** Latest workouts regardless of the range, newest first. */
  recent: WorkoutSummary[]
}
