// Data contract for the Health page. Owned by the Health slice: shape it to what the page renders.
//
// Everything here comes from `daily_metrics` (one value per day and metric). Metrics start on
// very different dates and some are measured only now and then, so every series carries its own
// dates: it begins at the metric's first value inside the selected range, not at the range start.
import type { Ymd } from '../dates'

export interface DateSpan {
  from: Ymd
  to: Ymd
}

/** Where a metric stands and how far it has moved inside the selected range. */
export interface MetricSummary {
  /** Days with a value inside the range. */
  count: number
  /**
   * The "now" figure. Metrics measured every day: mean of the 7 days ending on the latest value.
   * Metrics measured now and then: the latest reading. Null when the range holds no value.
   */
  current: number | null
  /** The days `current` is taken from (a single day for a reading). */
  currentSpan: DateSpan | null
  /**
   * The same figure at the start of the data inside the range: the mean of its first 7 days,
   * or the first reading. Null when there is too little data for the two not to overlap.
   */
  baseline: number | null
  baselineSpan: DateSpan | null
  /** The most recent value on or before today, whatever the range; for when the range is empty. */
  last: { date: Ymd; value: number } | null
}

export interface MetricSeries {
  /** Every day from the first value inside the range to today. Empty when the range has no value. */
  dates: Ymd[]
  /** Aligned with `dates`; null on days without a value. */
  values: (number | null)[]
  /**
   * Mean of the 7 days ending on each date, null while fewer than MIN_DAYS_FOR_AVERAGE of them
   * have a value. Null as a whole for metrics that are not measured daily.
   */
  avg7: (number | null)[] | null
}

export interface HealthMetric {
  summary: MetricSummary
  series: MetricSeries
}

/** A 7-day mean needs at least this many days with a value. */
export const MIN_DAYS_FOR_AVERAGE = 4

/**
 * Hours asleep, per night on short spans and averaged per week or month on long ones.
 * A night belongs to the date it ended on, and naps later that day are part of it.
 */
export interface SleepSeries {
  bucket: 'night' | 'week' | 'month'
  /** The night's date, the Monday of the week, or the 1st of the month. */
  starts: Ymd[]
  /** Mean hours asleep per night in the bucket; null without a night. */
  total: (number | null)[]
  /** Mean hours per stage over the nights that have stages; null when none has. */
  deep: (number | null)[]
  core: (number | null)[]
  rem: (number | null)[]
  /** Nights with data in each bucket. */
  nights: number[]
}

/** Average night over the range, from the nights that record sleep stages. */
export interface SleepStages {
  nights: number
  totalHours: number
  deepHours: number
  coreHours: number
  remHours: number
}

export interface HealthData {
  range: { from: Ymd; to: Ymd; weeks: number }
  /** False when the database holds none of the metrics on this page. */
  hasData: boolean
  restingHr: HealthMetric
  hrv: HealthMetric
  vo2max: HealthMetric
  hrRecovery: HealthMetric
  weight: HealthMetric
  sleep: {
    summary: MetricSummary
    series: SleepSeries
    /** Null when no night in the range has stages. */
    stages: SleepStages | null
    /** Shortest and longest night in the range. */
    shortest: { date: Ymd; hours: number } | null
    longest: { date: Ymd; hours: number } | null
  }
}
