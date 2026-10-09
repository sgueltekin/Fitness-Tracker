import { addDays, mondayOf, weekStartsBetween, type RangeKey, type Ymd } from '@shared/dates'
import { BEST_EFFORT_DISTANCES, RUN_CATEGORIES, type RunCategory } from '@shared/domain'
import type {
  BestEffort,
  Bucket,
  Compared,
  DistanceBucket,
  EasyTrendPoint,
  RunningData,
  ZoneTotal
} from '@shared/api/running'
import type { Db } from '../db'
import { all, bounds, SUMMARY_COLS, toSummary, type SummaryRow } from './util'

/** Length of the two windows behind the headline tiles. */
const RECENT_DAYS = 28
/** Charts switch from weekly to monthly columns above this many weeks, and to quarters above this many months. */
const MAX_WEEK_BUCKETS = 53
const MAX_MONTH_BUCKETS = 36
const KEY_CATEGORIES: RunCategory[] = ['tempo', 'intervals', 'long']
const KEY_SESSION_LIMIT = 5
const ZONE_COUNT = 5

// --- Buckets -----------------------------------------------------------------

const firstOfMonth = (year: number, month: number): Ymd => `${year}-${String(month).padStart(2, '0')}-01`

/** First day of the month `n` months after the month of `d`. */
function addMonths(d: Ymd, n: number): Ymd {
  const index = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 + n
  return firstOfMonth(Math.floor(index / 12), (index % 12) + 1)
}

/** Start of the bucket a date falls into: its Monday, or the first day of its month or quarter. */
export function bucketOf(d: Ymd, bucket: Bucket): Ymd {
  if (bucket === 'week') return mondayOf(d)
  const month = Number(d.slice(5, 7))
  return firstOfMonth(Number(d.slice(0, 4)), bucket === 'month' ? month : month - ((month - 1) % 3))
}

/** Every bucket start from the one containing `from` to the one containing `to`. */
export function bucketStarts(from: Ymd, to: Ymd, bucket: Bucket): Ymd[] {
  if (bucket === 'week') return weekStartsBetween(from, to)
  const out: Ymd[] = []
  for (let m = bucketOf(from, bucket); m <= to; m = addMonths(m, bucket === 'month' ? 1 : 3)) out.push(m)
  return out
}

/** The finest bucket that keeps a span readable: weeks up to a year, months up to three years, then quarters. */
export function pickBucket(from: Ymd, to: Ymd): Bucket {
  if (weekStartsBetween(from, to).length <= MAX_WEEK_BUCKETS) return 'week'
  return bucketStarts(from, to, 'month').length <= MAX_MONTH_BUCKETS ? 'month' : 'quarter'
}

// --- Aggregates --------------------------------------------------------------

type Effort = Pick<SummaryRow, 'duration_s' | 'distance_m' | 'avg_hr'>

/**
 * Pace and heart rate of a set of runs taken together.
 * Pace is total time over total distance, so a short run does not count as much as a long one;
 * heart rate is weighted by duration and uses only the runs that have one.
 */
export function effortStats(rows: Effort[]): { runs: number; paceSPerKm: number | null; hrRuns: number; avgHr: number | null } {
  let dist = 0
  let distTime = 0
  let hrTime = 0
  let hrSum = 0
  let hrRuns = 0
  for (const r of rows) {
    if (r.distance_m != null && r.distance_m > 0 && r.duration_s > 0) {
      dist += r.distance_m
      distTime += r.duration_s
    }
    if (r.avg_hr != null && r.duration_s > 0) {
      hrSum += r.avg_hr * r.duration_s
      hrTime += r.duration_s
      hrRuns++
    }
  }
  return {
    runs: rows.length,
    paceSPerKm: dist > 0 ? distTime / (dist / 1000) : null,
    hrRuns,
    avgHr: hrTime > 0 ? hrSum / hrTime : null
  }
}

/** A run's category for stacking; anything unexpected on a run counts as 'other'. */
function runCategory(r: SummaryRow): RunCategory {
  return (RUN_CATEGORIES as string[]).includes(r.cat) ? (r.cat as RunCategory) : 'other'
}

function distanceBuckets(rows: SummaryRow[], from: Ymd, to: Ymd, bucket: Bucket): DistanceBucket[] {
  const byStart = new Map<Ymd, DistanceBucket>()
  for (const start of bucketStarts(from, to, bucket)) byStart.set(start, { start, runs: 0, byCategory: {} })
  for (const r of rows) {
    const b = byStart.get(bucketOf(r.local_date, bucket))
    if (!b) continue
    b.runs++
    if (r.distance_m) {
      const cat = runCategory(r)
      b.byCategory[cat] = (b.byCategory[cat] ?? 0) + r.distance_m
    }
  }
  return [...byStart.values()]
}

/** Easy runs per bucket from the first easy run to `to`; picks its own bucket size for that span. */
export function easyTrend(easy: SummaryRow[], to: Ymd): { bucket: Bucket; points: EasyTrendPoint[] } {
  if (easy.length === 0) return { bucket: 'week', points: [] }
  const first = easy.reduce((min, r) => (r.local_date < min ? r.local_date : min), easy[0].local_date)
  const bucket = pickBucket(first, to)
  const groups = new Map<Ymd, SummaryRow[]>()
  for (const r of easy) {
    const key = bucketOf(r.local_date, bucket)
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  const points = bucketStarts(first, to, bucket).map((start) => ({ start, ...effortStats(groups.get(start) ?? []) }))
  return { bucket, points }
}

// --- Query -------------------------------------------------------------------

function runsBetween(db: Db, from: Ymd, to: Ymd): SummaryRow[] {
  return all<SummaryRow>(
    db,
    `SELECT ${SUMMARY_COLS} FROM workouts_v
     WHERE sport = 'run' AND local_date BETWEEN ? AND ?
     ORDER BY local_date, start_ts`,
    from,
    to
  )
}

function bestEfforts(db: Db): BestEffort[] {
  // Fastest first per distance; the earlier run wins a tie.
  const rows = all<{ distance_m: number; duration_s: number; id: number; local_date: Ymd }>(
    db,
    `SELECT b.distance_m, b.duration_s, w.id, w.local_date
     FROM best_efforts b JOIN workouts_v w ON w.id = b.workout_id
     WHERE w.sport = 'run'
     ORDER BY b.distance_m, b.duration_s, w.start_ts`
  )
  return BEST_EFFORT_DISTANCES.map((distanceM) => {
    const best = rows.find((r) => r.distance_m === distanceM)
    return best
      ? { distanceM, durationS: best.duration_s, workoutId: best.id, date: best.local_date }
      : { distanceM, durationS: null, workoutId: null, date: null }
  })
}

function zoneTotals(db: Db, from: Ymd, to: Ymd): RunningData['zones'] {
  const rows = all<{ workout_id: number; zone: number; seconds: number; min_bpm: number | null; max_bpm: number | null }>(
    db,
    `SELECT z.workout_id, z.zone, z.seconds, z.min_bpm, z.max_bpm
     FROM hr_zones z JOIN workouts_v w ON w.id = z.workout_id
     WHERE w.sport = 'run' AND w.local_date BETWEEN ? AND ? AND z.zone BETWEEN 1 AND ${ZONE_COUNT}
     ORDER BY w.start_ts, z.zone`,
    from,
    to
  )
  if (rows.length === 0) return { runsWithZones: 0, zones: [] }
  const zones: ZoneTotal[] = Array.from({ length: ZONE_COUNT }, (_, i) => ({ zone: i + 1, seconds: 0, minBpm: null, maxBpm: null }))
  const latest = rows[rows.length - 1].workout_id
  for (const r of rows) {
    const z = zones[r.zone - 1]
    z.seconds += r.seconds
    if (r.workout_id === latest) {
      z.minBpm = r.min_bpm
      z.maxBpm = r.max_bpm
    }
  }
  return { runsWithZones: new Set(rows.map((r) => r.workout_id)).size, zones }
}

export function getRunning(db: Db, range: RangeKey): RunningData {
  const { from, to } = bounds(db, range)

  // Rolling windows for the tiles: the last 28 days and the 28 before, whatever the range is.
  // Whole days rather than calendar weeks, so a half-finished current week does not drag the average down.
  const nowFrom = addDays(to, -(RECENT_DAYS - 1))
  const beforeFrom = addDays(to, -(2 * RECENT_DAYS - 1))
  const recentRows = runsBetween(db, beforeFrom, to)
  const nowRows = recentRows.filter((r) => r.local_date >= nowFrom)
  const beforeRows = recentRows.filter((r) => r.local_date < nowFrom)
  const metres = (rows: SummaryRow[]): number => rows.reduce((sum, r) => sum + (r.distance_m ?? 0), 0)
  const isEasy = (r: SummaryRow): boolean => r.cat === 'easy'
  const easyNow = effortStats(nowRows.filter(isEasy))
  const easyBefore = effortStats(beforeRows.filter(isEasy))
  const compared = (key: 'paceSPerKm' | 'avgHr'): Compared => ({ now: easyNow[key], before: easyBefore[key] })
  const weeksPerWindow = RECENT_DAYS / 7

  const rows = runsBetween(db, from, to)
  const bucket = pickBucket(from, to)
  const longest = rows.reduce<SummaryRow | null>(
    (best, r) => (r.distance_m != null && r.distance_m > (best?.distance_m ?? 0) ? r : best),
    null
  )

  return {
    from,
    to,
    totals: {
      runs: rows.length,
      distanceM: metres(rows),
      durationS: rows.reduce((sum, r) => sum + r.duration_s, 0)
    },
    recent: {
      days: RECENT_DAYS,
      weeklyDistanceM: { now: metres(nowRows) / weeksPerWindow, before: metres(beforeRows) / weeksPerWindow },
      easyPaceSPerKm: compared('paceSPerKm'),
      easyHr: compared('avgHr'),
      easyRuns: easyNow.runs
    },
    longest: longest ? toSummary(longest) : null,
    distance: { bucket, buckets: distanceBuckets(rows, from, to, bucket) },
    bests: bestEfforts(db),
    easyTrend: easyTrend(rows.filter(isEasy), to),
    zones: zoneTotals(db, from, to),
    keySessions: rows
      .filter((r) => KEY_CATEGORIES.includes(runCategory(r)))
      .reverse()
      .slice(0, KEY_SESSION_LIMIT)
      .map(toSummary)
  }
}
