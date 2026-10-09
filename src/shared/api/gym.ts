// Data contract for the Gym page. Owned by the Gym slice: shape it to what the page renders.
//
// Strength sessions come from a watch, so all there is to show is when they happened,
// how long they took and how hard they were (heart rate, energy, Apple's effort score).
// There are no exercises, sets or weights in the data.
import type { Ymd } from '../dates'
import type { WorkoutSummary } from './common'

/** One column of the training-time chart: a Monday-based week, or a calendar month on long ranges. */
export interface GymBucket {
  /** First day of the bucket: the Monday of a week, the 1st of a month. */
  start: Ymd
  sessions: number
  durationS: number
}

/** One session with its effort measures. Each measure is null when the session was logged without it. */
export interface GymSession {
  id: number
  name: string
  date: Ymd
  durationS: number
  avgHr: number | null
  maxHr: number | null
  /** Active energy. Null when missing or too low to be a measurement (see measuredEnergyKcal in domain.ts). */
  energyKcal: number | null
  /** Apple's effort score, 1 to 10. */
  effort: number | null
}

export interface GymSummary {
  sessions: number
  /** Sessions in the equally long period right before the range; null for 'all'. */
  prevSessions: number | null
  /** Calendar weeks of the range with at least one session. */
  weeksTrained: number
  /**
   * Consecutive weeks with a session, counted back from the current week over all history.
   * A current week without a session yet does not break the run.
   */
  streakWeeks: number
  totalDurationS: number
  avgDurationS: number | null
  longest: { id: number; date: Ymd; durationS: number } | null
  /** Mean of the sessions' average heart rates, over the sessions that have one. */
  avgHr: number | null
  hrSessions: number
  avgEnergyKcal: number | null
  energySessions: number
  avgEffort: number | null
  effortSessions: number
}

export interface GymData {
  range: { from: Ymd; to: Ymd; weeks: number }
  /** Strength sessions in the whole database; 0 means the page has nothing to show at all. */
  totalSessions: number
  /** Date of the most recent session ever, for the empty state of a range without sessions. */
  lastSessionDate: Ymd | null
  summary: GymSummary
  bucket: 'week' | 'month'
  /** Every bucket of the range, including empty ones, oldest first. */
  buckets: GymBucket[]
  /** Sessions in the range per weekday, Monday first. */
  weekdays: number[]
  /** Every session in the range, oldest first. */
  sessions: GymSession[]
  /** The newest sessions of the range for the table, newest first; at most GYM_TABLE_LIMIT. */
  table: WorkoutSummary[]
}

export const GYM_TABLE_LIMIT = 50
