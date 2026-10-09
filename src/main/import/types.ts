import type { Category, Sport } from '@shared/domain'

/** A time series point: [seconds from workout start, value]. */
export type Pt = [number, number]

export type WorkoutEventType = 'Lap' | 'Segment' | 'Pause' | 'Resume' | 'MotionPaused' | 'MotionResumed' | 'Marker'

export interface WorkoutEvent {
  type: WorkoutEventType
  /** Unix seconds. */
  ts: number
  durationS: number | null
}

export interface HrZone {
  minBpm: number | null
  maxBpm: number | null
  seconds: number
}

/** A <Workout> element as read from the export, converted to SI-ish units but not yet derived. */
export interface RawWorkout {
  /** HealthKit activity type without the 'HKWorkoutActivityType' prefix. */
  activityType: string
  sport: Sport
  /** sourceName exactly as written; record sources are matched against this. */
  sourceRaw: string
  /** sourceName with surrounding (non-breaking) spaces removed. */
  source: string
  startTs: number
  endTs: number
  tzOffsetMin: number
  durationS: number
  title: string | null
  indoor: boolean
  userEntered: boolean
  externalUuid: string | null
  /** The workout was recorded on an Apple Watch (by the device attribute or the source name). */
  fromWatch: boolean
  distanceM: number | null
  energyKcal: number | null
  avgHr: number | null
  minHr: number | null
  maxHr: number | null
  avgPowerW: number | null
  avgStrideM: number | null
  avgGctMs: number | null
  avgVertOscCm: number | null
  stepCount: number | null
  elevationGainM: number | null
  effort: number | null
  events: WorkoutEvent[]
  zones: HrZone[]
  /** FileReference path of the GPX route, e.g. '/workout-routes/route_2024-01-31_6.05pm.gpx'. */
  routePath: string | null
}

export interface LapRow {
  idx: number
  startOffsetS: number
  durationS: number
  distanceM: number | null
  avgHr: number | null
}

export interface SplitRow {
  idx: number
  distanceM: number
  durationS: number
  avgHr: number | null
}

export interface BestEffortRow {
  distanceM: number
  durationS: number
  startOffsetS: number
}

/** Everything written for one workout. */
export interface WorkoutRecord {
  uid: string
  sport: Sport
  activityType: string
  category: Category
  title: string | null
  source: string
  startTs: number
  endTs: number
  tzOffsetMin: number
  localDate: string
  durationS: number
  distanceM: number | null
  energyKcal: number | null
  avgHr: number | null
  minHr: number | null
  maxHr: number | null
  avgPowerW: number | null
  avgStrideM: number | null
  avgGctMs: number | null
  avgVertOscCm: number | null
  stepCount: number | null
  elevationGainM: number | null
  effort: number | null
  indoor: boolean
  userEntered: boolean
  hasRoute: boolean
  laps: LapRow[]
  splits: SplitRow[]
  zones: HrZone[]
  bestEfforts: BestEffortRow[]
  /** kind -> JSON-serialisable array; only kinds that have data. */
  streams: Record<string, unknown[]>
}

export interface DailyMetricRow {
  date: string
  metric: string
  value: number
}

export type SleepStage = 'core' | 'deep' | 'rem' | 'unspecified'

/** One asleep interval from a SleepAnalysis record. */
export interface SleepSegment {
  startTs: number
  endTs: number
  /** UTC offset of the end timestamp, in minutes. */
  tzOffsetMin: number
  stage: SleepStage
  source: string
}
