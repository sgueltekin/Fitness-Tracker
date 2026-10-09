import { addDays, mondayOf, weekdayIndex, weekStartsBetween, type RangeKey, type Ymd } from '@shared/dates'
import { measuredEnergyKcal } from '@shared/domain'
import { GYM_TABLE_LIMIT, type GymBucket, type GymData, type GymSession, type GymSummary } from '@shared/api/gym'
import type { Db } from '../db'
import { all, bounds, get, SUMMARY_COLS, toSummary, type SummaryRow } from './util'

/** Ranges longer than this many weeks are charted per month instead of per week. */
const MAX_WEEKLY_BUCKETS = 53

interface Row extends SummaryRow {
  energy_kcal: number | null
  max_hr: number | null
  effort: number | null
}

function monthStart(d: Ymd): Ymd {
  return `${d.slice(0, 7)}-01`
}

/** The 1st of every month from the month containing `from` to the month containing `to`. */
export function monthStartsBetween(from: Ymd, to: Ymd): Ymd[] {
  const out: Ymd[] = []
  let [y, m] = from.split('-').map(Number)
  const last = monthStart(to)
  for (;;) {
    const s = `${y}-${String(m).padStart(2, '0')}-01`
    if (s > last) break
    out.push(s)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/**
 * Consecutive weeks with a session, walking back from the week of `today`.
 * The current week is still running, so an empty one is skipped rather than ending the run.
 */
export function weekStreak(trainedWeeks: Set<Ymd>, today: Ymd): number {
  let w = mondayOf(today)
  if (!trainedWeeks.has(w)) w = addDays(w, -7)
  let n = 0
  while (trainedWeeks.has(w)) {
    n++
    w = addDays(w, -7)
  }
  return n
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function present(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v != null)
}

export function getGym(db: Db, range: RangeKey): GymData {
  const b = bounds(db, range)

  const rows = all<Row>(
    db,
    `SELECT ${SUMMARY_COLS}, energy_kcal, max_hr, effort
       FROM workouts_v
      WHERE sport = 'strength' AND local_date BETWEEN ? AND ?
      ORDER BY start_ts`,
    b.from,
    b.to
  )

  const sessions: GymSession[] = rows.map((r) => {
    const s = toSummary(r)
    return {
      id: s.id,
      name: s.name,
      date: s.date,
      durationS: s.durationS,
      avgHr: r.avg_hr && r.avg_hr > 0 ? r.avg_hr : null,
      maxHr: r.max_hr && r.max_hr > 0 ? r.max_hr : null,
      energyKcal: measuredEnergyKcal(r.energy_kcal, r.duration_s),
      effort: r.effort && r.effort > 0 ? r.effort : null
    }
  })

  // Time per week, or per month when the range is too long for weekly columns.
  const bucket: GymData['bucket'] = b.weeks > MAX_WEEKLY_BUCKETS ? 'month' : 'week'
  const starts = bucket === 'week' ? weekStartsBetween(b.from, b.to) : monthStartsBetween(b.from, b.to)
  const byStart = new Map<Ymd, GymBucket>(starts.map((start) => [start, { start, sessions: 0, durationS: 0 }]))
  const weekdays = [0, 0, 0, 0, 0, 0, 0]
  const weeksInRange = new Set<Ymd>()
  for (const s of sessions) {
    const slot = byStart.get(bucket === 'week' ? mondayOf(s.date) : monthStart(s.date))
    if (slot) {
      slot.sessions++
      slot.durationS += s.durationS
    }
    weekdays[weekdayIndex(s.date)]++
    weeksInRange.add(mondayOf(s.date))
  }

  const allDates = all<{ d: Ymd }>(db, `SELECT local_date AS d FROM workouts_v WHERE sport = 'strength' AND local_date <= ?`, b.to)
  const everTrained = new Set(allDates.map((r) => mondayOf(r.d)))
  const lastSessionDate = allDates.reduce<Ymd | null>((max, r) => (max === null || r.d > max ? r.d : max), null)

  let prevSessions: number | null = null
  if (range !== 'all') {
    const prevFrom = addDays(b.from, -7 * b.weeks)
    const row = get<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM workouts_v WHERE sport = 'strength' AND local_date >= ? AND local_date < ?`,
      prevFrom,
      b.from
    )
    prevSessions = row?.n ?? 0
  }

  const totalDurationS = sessions.reduce((a, s) => a + s.durationS, 0)
  const longest = sessions.reduce<GymSession | null>((best, s) => (best === null || s.durationS > best.durationS ? s : best), null)
  const hr = present(sessions.map((s) => s.avgHr))
  const energy = present(sessions.map((s) => s.energyKcal))
  const effort = present(sessions.map((s) => s.effort))

  const summary: GymSummary = {
    sessions: sessions.length,
    prevSessions,
    weeksTrained: weeksInRange.size,
    streakWeeks: weekStreak(everTrained, b.to),
    totalDurationS,
    avgDurationS: sessions.length ? totalDurationS / sessions.length : null,
    longest: longest ? { id: longest.id, date: longest.date, durationS: longest.durationS } : null,
    avgHr: mean(hr),
    hrSessions: hr.length,
    avgEnergyKcal: mean(energy),
    energySessions: energy.length,
    avgEffort: mean(effort),
    effortSessions: effort.length
  }

  return {
    range: { from: b.from, to: b.to, weeks: b.weeks },
    totalSessions: allDates.length,
    lastSessionDate,
    summary,
    bucket,
    buckets: starts.map((s) => byStart.get(s)!),
    weekdays,
    sessions,
    table: rows.slice(-GYM_TABLE_LIMIT).reverse().map(toSummary)
  }
}
