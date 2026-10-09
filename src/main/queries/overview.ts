import { addDays, mondayOf, todayYmd, weekStartsBetween, type RangeKey, type Ymd } from '@shared/dates'
import { TRAINING_CATEGORIES, type Category, type Sport } from '@shared/domain'
import type {
  BucketUnit,
  OverviewBucket,
  OverviewData,
  OverviewDay,
  OverviewGym,
  OverviewMixRow,
  OverviewWindow
} from '@shared/api/overview'
import type { Db } from '../db'
import { SUMMARY_COLS, all, bounds, get, toSummary, type SummaryRow } from './util'

const WINDOW_DAYS = 7
const MAX_WINDOWS = 12
/** Ranges up to this many weeks are charted per week; longer ones per month. */
const MAX_WEEK_BUCKETS = 53
/** The day calendar never shows more than this many weeks. */
const MAX_CALENDAR_WEEKS = 53
const RECENT_COUNT = 8

interface Row {
  local_date: Ymd
  sport: Sport
  cat: Category
  duration_s: number
  distance_m: number | null
  avg_hr: number | null
  effort: number | null
}

const monthStart = (d: Ymd): Ymd => `${d.slice(0, 7)}-01`

function nextMonth(start: Ymd): Ymd {
  const y = Number(start.slice(0, 4))
  const m = Number(start.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function bucketStarts(from: Ymd, to: Ymd, unit: BucketUnit): Ymd[] {
  if (unit === 'week') return weekStartsBetween(from, to)
  const out: Ymd[] = []
  for (let m = monthStart(from); m <= to; m = nextMonth(m)) out.push(m)
  return out
}

/** Stack key of a workout: its category, or 'other' for sports outside the training stack. */
function stackKey(cat: Category): Category {
  return TRAINING_CATEGORIES.includes(cat) ? cat : 'other'
}

function buildWindows(rows: Row[], today: Ymd, count: number): OverviewWindow[] {
  const windows: OverviewWindow[] = []
  for (let i = count - 1; i >= 0; i--) {
    const to = addDays(today, -WINDOW_DAYS * i)
    windows.push({ from: addDays(to, -(WINDOW_DAYS - 1)), to, runDistanceM: 0, trainingS: 0, runs: 0, gymSessions: 0 })
  }
  for (const r of rows) {
    const w = windows.find((x) => r.local_date >= x.from && r.local_date <= x.to)
    if (!w) continue
    w.trainingS += r.duration_s
    if (r.sport === 'run') {
      w.runs++
      w.runDistanceM += r.distance_m ?? 0
    }
    if (r.cat === 'strength') w.gymSessions++
  }
  return windows
}

function buildBuckets(rows: Row[], from: Ymd, today: Ymd, unit: BucketUnit, effortSince: Ymd | null): OverviewBucket[] {
  const starts = bucketStarts(from, today, unit)
  const keyOf = unit === 'week' ? mondayOf : monthStart
  const currentKey = keyOf(today)
  const byStart = new Map<Ymd, OverviewBucket & { runsWithDistance: number; loadSum: number }>()
  for (const start of starts) {
    byStart.set(start, {
      start,
      current: start === currentKey,
      sessions: 0,
      seconds: {},
      runs: 0,
      runDistanceM: null,
      gymSessions: 0,
      load: null,
      loadRun: 0,
      loadGym: 0,
      ratedSessions: 0,
      runsWithDistance: 0,
      loadSum: 0
    })
  }
  for (const r of rows) {
    const b = byStart.get(keyOf(r.local_date))
    if (!b) continue
    b.sessions++
    const key = stackKey(r.cat)
    b.seconds[key] = (b.seconds[key] ?? 0) + r.duration_s
    if (r.sport === 'run') {
      b.runs++
      if (r.distance_m != null) {
        b.runsWithDistance++
        b.runDistanceM = (b.runDistanceM ?? 0) + r.distance_m
      }
    }
    if (r.cat === 'strength') b.gymSessions++
    if (r.effort != null) {
      const load = (r.effort * r.duration_s) / 60
      b.ratedSessions++
      b.loadSum += load
      if (r.sport === 'run') b.loadRun += load
      else if (r.cat === 'strength') b.loadGym += load
    }
  }
  return starts.map((start, i) => {
    const { runsWithDistance, loadSum, ...b } = byStart.get(start)!
    const end = i + 1 < starts.length ? addDays(starts[i + 1], -1) : today
    if (b.runs === 0) b.runDistanceM = 0
    else if (runsWithDistance === 0) b.runDistanceM = null
    const beforeRatings = effortSince == null || end < effortSince
    if (b.ratedSessions > 0) b.load = loadSum
    else b.load = beforeRatings || b.sessions > 0 ? null : 0
    return b
  })
}

function buildMix(rows: Row[]): OverviewMixRow[] {
  const acc = new Map<Category, OverviewMixRow>()
  for (const r of rows) {
    const key = stackKey(r.cat)
    const m = acc.get(key) ?? { category: key, seconds: 0, sessions: 0 }
    m.seconds += r.duration_s
    m.sessions++
    acc.set(key, m)
  }
  return TRAINING_CATEGORIES.flatMap((c) => {
    const m = acc.get(c)
    return m && m.seconds > 0 ? [m] : []
  })
}

function buildDays(rows: Row[]): OverviewDay[] {
  const acc = new Map<Ymd, OverviewDay>()
  for (const r of rows) {
    const d = acc.get(r.local_date) ?? { date: r.local_date, seconds: 0, sessions: 0, categories: [] }
    d.seconds += r.duration_s
    d.sessions++
    if (!d.categories.includes(r.cat)) d.categories.push(r.cat)
    acc.set(r.local_date, d)
  }
  return [...acc.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

function buildGym(rows: Row[]): OverviewGym {
  const gym = rows.filter((r) => r.cat === 'strength')
  const withHr = gym.filter((r) => r.avg_hr != null)
  return {
    sessions: gym.length,
    avgDurationS: gym.length ? gym.reduce((s, r) => s + r.duration_s, 0) / gym.length : null,
    avgHr: withHr.length ? withHr.reduce((s, r) => s + (r.avg_hr as number), 0) / withHr.length : null,
    hrSessions: withHr.length
  }
}

export function getOverview(db: Db, range: RangeKey): OverviewData {
  const today = todayYmd()
  const b = bounds(db, range)
  const unit: BucketUnit = b.weeks <= MAX_WEEK_BUCKETS ? 'week' : 'month'

  // The 7-day windows are anchored on today, not on Mondays, so they can start a few days before the range.
  const windowCount = Math.max(2, Math.min(MAX_WINDOWS, b.weeks))
  const windowsFrom = addDays(today, -WINDOW_DAYS * windowCount + 1)
  const queryFrom = windowsFrom < b.from ? windowsFrom : b.from

  const rows = all<Row>(
    db,
    `SELECT local_date, sport, cat, duration_s, distance_m, avg_hr, effort
     FROM workouts_v WHERE local_date BETWEEN ? AND ? ORDER BY start_ts`,
    queryFrom,
    today
  )
  const inRange = rows.filter((r) => r.local_date >= b.from)

  const effortSince = get<{ d: Ymd | null }>(db, 'SELECT MIN(local_date) AS d FROM workouts_v WHERE effort IS NOT NULL')?.d ?? null

  const calendarWeeks = Math.min(b.weeks, MAX_CALENDAR_WEEKS)
  const calendarFrom = addDays(mondayOf(today), -7 * (calendarWeeks - 1))

  const recent = all<SummaryRow>(
    db,
    `SELECT ${SUMMARY_COLS} FROM workouts_v WHERE local_date <= ? ORDER BY start_ts DESC LIMIT ${RECENT_COUNT}`,
    today
  ).map(toSummary)

  return {
    today,
    rangeKey: range,
    range: b,
    unit,
    windows: buildWindows(rows, today, windowCount),
    buckets: buildBuckets(inRange, b.from, today, unit, effortSince),
    mix: buildMix(inRange),
    calendar: {
      from: calendarFrom,
      to: today,
      weeks: calendarWeeks,
      capped: calendarWeeks < b.weeks,
      days: buildDays(inRange.filter((r) => r.local_date >= calendarFrom))
    },
    gym: buildGym(inRange),
    effortSince,
    recent
  }
}
