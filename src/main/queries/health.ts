import { addDays, daysBetween, diffDays, mondayOf, weekStartsBetween, type RangeKey, type Ymd } from '@shared/dates'
import {
  MIN_DAYS_FOR_AVERAGE,
  type HealthData,
  type HealthMetric,
  type MetricSeries,
  type MetricSummary,
  type SleepSeries,
  type SleepStages
} from '@shared/api/health'
import type { Db } from '../db'
import { monthStartsBetween } from './gym'
import { all, bounds, get } from './util'

export interface Point {
  date: Ymd
  value: number
}

/** A night's sleep as stored: total hours, and the stages when the source records them. */
export interface Night {
  date: Ymd
  total: number
  deep: number | null
  core: number | null
  rem: number | null
}

/** Sleep is drawn per night up to this many days, then per week, then per month. */
const MAX_NIGHTLY_DAYS = 100
const MAX_WEEKLY_DAYS = 800

function round(v: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function roundedMean(values: number[]): number | null {
  const m = mean(values)
  return m === null ? null : round(m)
}

/**
 * Lays values out on consecutive days, from the first value inside [from, to] up to `to`.
 * `points` is sorted by date and may start before `from`; those earlier values only feed
 * the 7-day mean of the first days. `daily` adds that mean.
 */
export function buildSeries(points: Point[], from: Ymd, to: Ymd, daily: boolean): MetricSeries {
  const first = points.find((p) => p.date >= from && p.date <= to)
  if (!first) return { dates: [], values: [], avg7: daily ? [] : null }
  const byDate = new Map(points.map((p) => [p.date, p.value]))
  const dates = daysBetween(first.date, to)
  const values = dates.map((d) => byDate.get(d) ?? null)
  if (!daily) return { dates, values, avg7: null }
  const avg7 = dates.map((d) => {
    const window: number[] = []
    for (let i = 0; i < 7; i++) {
      const v = byDate.get(addDays(d, -i))
      if (v !== undefined) window.push(v)
    }
    return window.length >= MIN_DAYS_FOR_AVERAGE ? roundedMean(window) : null
  })
  return { dates, values, avg7 }
}

/**
 * The tile figures for one metric. `points` are the values inside the range, sorted by date.
 * Daily metrics compare the mean of their last 7 days with the mean of their first 7;
 * occasional ones compare the latest reading with the first. Without two separate
 * stretches of data there is no baseline.
 */
export function summarize(points: Point[], daily: boolean, last: Point | null): MetricSummary {
  if (points.length === 0) {
    return { count: 0, current: null, currentSpan: null, baseline: null, baselineSpan: null, last }
  }
  const first = points[0]
  const latest = points[points.length - 1]
  if (!daily) {
    const moved = first.date !== latest.date
    return {
      count: points.length,
      current: latest.value,
      currentSpan: { from: latest.date, to: latest.date },
      baseline: moved ? first.value : null,
      baselineSpan: moved ? { from: first.date, to: first.date } : null,
      last
    }
  }
  const currentFrom = addDays(latest.date, -6)
  const baselineTo = addDays(first.date, 6)
  const comparable = baselineTo < currentFrom
  return {
    count: points.length,
    current: roundedMean(points.filter((p) => p.date >= currentFrom).map((p) => p.value)),
    currentSpan: { from: currentFrom > first.date ? currentFrom : first.date, to: latest.date },
    baseline: comparable ? roundedMean(points.filter((p) => p.date <= baselineTo).map((p) => p.value)) : null,
    baselineSpan: comparable ? { from: first.date, to: baselineTo } : null,
    last
  }
}

/** Groups nights into the columns of the sleep chart; `nights` is sorted by date and inside [.., to]. */
export function buildSleepSeries(nights: Night[], to: Ymd): SleepSeries {
  if (nights.length === 0) return { bucket: 'night', starts: [], total: [], deep: [], core: [], rem: [], nights: [] }
  const first = nights[0].date
  const days = diffDays(first, to) + 1
  const bucket: SleepSeries['bucket'] = days <= MAX_NIGHTLY_DAYS ? 'night' : days <= MAX_WEEKLY_DAYS ? 'week' : 'month'
  const starts = bucket === 'night' ? daysBetween(first, to) : bucket === 'week' ? weekStartsBetween(first, to) : monthStartsBetween(first, to)
  const keyOf = (d: Ymd): Ymd => (bucket === 'night' ? d : bucket === 'week' ? mondayOf(d) : `${d.slice(0, 7)}-01`)

  const groups = new Map<Ymd, Night[]>()
  for (const n of nights) {
    const k = keyOf(n.date)
    const g = groups.get(k)
    if (g) g.push(n)
    else groups.set(k, [n])
  }
  const col = (pick: (n: Night) => number | null): (number | null)[] =>
    starts.map((s) => roundedMean((groups.get(s) ?? []).map(pick).filter((v): v is number => v !== null)))

  return {
    bucket,
    starts,
    total: col((n) => n.total),
    deep: col((n) => n.deep),
    core: col((n) => n.core),
    rem: col((n) => n.rem),
    nights: starts.map((s) => groups.get(s)?.length ?? 0)
  }
}

/** The average night, over the nights that have all three stages. */
export function sleepStages(nights: Night[]): SleepStages | null {
  const staged = nights.filter((n) => n.deep !== null && n.core !== null && n.rem !== null)
  if (staged.length === 0) return null
  return {
    nights: staged.length,
    totalHours: round(mean(staged.map((n) => n.total))!),
    deepHours: round(mean(staged.map((n) => n.deep!))!),
    coreHours: round(mean(staged.map((n) => n.core!))!),
    remHours: round(mean(staged.map((n) => n.rem!))!)
  }
}

function points(db: Db, metric: string, from: Ymd, to: Ymd): Point[] {
  return all<Point>(db, 'SELECT date, value FROM daily_metrics WHERE metric = ? AND date BETWEEN ? AND ? ORDER BY date', metric, from, to)
}

function lastPoint(db: Db, metric: string, to: Ymd): Point | null {
  return get<Point>(db, 'SELECT date, value FROM daily_metrics WHERE metric = ? AND date <= ? ORDER BY date DESC LIMIT 1', metric, to) ?? null
}

function metric(db: Db, name: string, from: Ymd, to: Ymd, daily: boolean): HealthMetric {
  // Six days of lead-in so the 7-day mean is complete from the first day of the range.
  const withLeadIn = points(db, name, daily ? addDays(from, -6) : from, to)
  const inRange = withLeadIn.filter((p) => p.date >= from)
  return {
    summary: summarize(inRange, daily, lastPoint(db, name, to)),
    series: buildSeries(withLeadIn, from, to, daily)
  }
}

function sleepNights(db: Db, from: Ymd, to: Ymd): Night[] {
  const rows = all<{ date: Ymd; metric: string; value: number }>(
    db,
    `SELECT date, metric, value FROM daily_metrics
      WHERE metric IN ('sleep_hours', 'sleep_deep_hours', 'sleep_core_hours', 'sleep_rem_hours')
        AND date BETWEEN ? AND ?
      ORDER BY date`,
    from,
    to
  )
  const byDate = new Map<Ymd, Partial<Record<string, number>>>()
  for (const r of rows) {
    const d = byDate.get(r.date)
    if (d) d[r.metric] = r.value
    else byDate.set(r.date, { [r.metric]: r.value })
  }
  const nights: Night[] = []
  for (const [date, m] of byDate) {
    if (m.sleep_hours === undefined) continue
    nights.push({
      date,
      total: m.sleep_hours,
      deep: m.sleep_deep_hours ?? null,
      core: m.sleep_core_hours ?? null,
      rem: m.sleep_rem_hours ?? null
    })
  }
  return nights
}

const PAGE_METRICS = ['resting_hr', 'hrv_sdnn', 'vo2max', 'hr_recovery_1min', 'weight_kg', 'sleep_hours']

export function getHealth(db: Db, range: RangeKey): HealthData {
  const b = bounds(db, range)
  const any = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM daily_metrics WHERE metric IN (${PAGE_METRICS.map(() => '?').join(', ')}) LIMIT 1)`,
    ...PAGE_METRICS
  )

  const nights = sleepNights(db, b.from, b.to)
  const extreme = (pick: (a: Night, b: Night) => boolean): { date: Ymd; hours: number } | null => {
    const n = nights.reduce<Night | null>((best, x) => (best === null || pick(x, best) ? x : best), null)
    return n ? { date: n.date, hours: n.total } : null
  }

  return {
    range: { from: b.from, to: b.to, weeks: b.weeks },
    hasData: (any?.n ?? 0) > 0,
    restingHr: metric(db, 'resting_hr', b.from, b.to, true),
    hrv: metric(db, 'hrv_sdnn', b.from, b.to, true),
    vo2max: metric(db, 'vo2max', b.from, b.to, false),
    hrRecovery: metric(db, 'hr_recovery_1min', b.from, b.to, false),
    weight: metric(db, 'weight_kg', b.from, b.to, false),
    sleep: {
      summary: summarize(
        nights.map((n) => ({ date: n.date, value: n.total })),
        true,
        lastPoint(db, 'sleep_hours', b.to)
      ),
      series: buildSleepSeries(nights, b.to),
      stages: sleepStages(nights),
      shortest: extreme((a, x) => a.total < x.total),
      longest: extreme((a, x) => a.total > x.total)
    }
  }
}
