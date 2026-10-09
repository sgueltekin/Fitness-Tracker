// One value per day and metric, from what the collector aggregated during the XML pass.
import { SOURCE_SLOTS, type HealthCollector } from './collect'
import { dateOfDayNumber, localDate } from './time'
import type { DailyMetricRow, SleepSegment } from './types'

export interface SleepNight {
  /** Local date the sleep ended on. */
  date: string
  source: string
  hours: number
  /** Null when the source does not record sleep stages. */
  deepHours: number | null
  remHours: number | null
  coreHours: number | null
}

interface SleepTotals {
  total: number
  deep: number
  rem: number
  core: number
  staged: boolean
}

/** Asleep intervals closer together than this belong to one stretch of sleep. */
export const SLEEP_SESSION_GAP_S = 3 * 3600

/**
 * Sums asleep time per night. Per source, intervals separated by less than `gapS` form one
 * session, and a session counts for the local date it ends on (so does a later nap that
 * day). When several sources cover a date, one is used: an Apple Watch if there is one,
 * otherwise the source with the most sleep. Overlapping intervals are not counted twice.
 */
export function attributeSleep(segments: SleepSegment[], gapS = SLEEP_SESSION_GAP_S): SleepNight[] {
  const bySource = new Map<string, SleepSegment[]>()
  for (const s of segments) {
    if (!(s.endTs > s.startTs)) continue
    const list = bySource.get(s.source)
    if (list) list.push(s)
    else bySource.set(s.source, [s])
  }

  const byDate = new Map<string, Map<string, SleepTotals>>()
  for (const [source, list] of bySource) {
    list.sort((a, b) => a.startTs - b.startTs || a.endTs - b.endTs)
    let session: SleepTotals | null = null
    let sessionEnd = -Infinity
    let sessionOffset = 0
    const close = (): void => {
      if (!session || session.total <= 0) return
      const date = localDate(sessionEnd, sessionOffset)
      let sources = byDate.get(date)
      if (!sources) byDate.set(date, (sources = new Map()))
      const acc = sources.get(source)
      if (!acc) sources.set(source, session)
      else {
        acc.total += session.total
        acc.deep += session.deep
        acc.rem += session.rem
        acc.core += session.core
        acc.staged ||= session.staged
      }
    }
    for (const seg of list) {
      if (!session || seg.startTs - sessionEnd > gapS) {
        close()
        session = { total: 0, deep: 0, rem: 0, core: 0, staged: false }
        sessionEnd = -Infinity
      }
      // Only the part after everything counted so far is new sleep.
      const from = Math.max(seg.startTs, sessionEnd)
      if (seg.endTs > from) {
        const seconds = seg.endTs - from
        session.total += seconds
        if (seg.stage !== 'unspecified') {
          session[seg.stage] += seconds
          session.staged = true
        }
        sessionEnd = seg.endTs
        sessionOffset = seg.tzOffsetMin
      }
    }
    close()
  }

  const nights: SleepNight[] = []
  for (const [date, sources] of byDate) {
    let chosen: [string, SleepTotals] | null = null
    for (const entry of sources) {
      if (!chosen) {
        chosen = entry
        continue
      }
      const watch = /watch/i.test(entry[0])
      const chosenWatch = /watch/i.test(chosen[0])
      if (watch !== chosenWatch ? watch : entry[1].total > chosen[1].total) chosen = entry
    }
    if (!chosen) continue
    const [source, t] = chosen
    nights.push({
      date,
      source,
      hours: t.total / 3600,
      deepHours: t.staged ? t.deep / 3600 : null,
      remHours: t.staged ? t.rem / 3600 : null,
      coreHours: t.staged ? t.core / 3600 : null
    })
  }
  nights.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return nights
}

/** Sums per (day, source) reduced to one value per day: the largest single source. */
export function largestSourcePerDay(byDaySource: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>()
  for (const [key, value] of byDaySource) {
    const day = Math.floor(key / SOURCE_SLOTS)
    const best = out.get(day)
    if (best === undefined || value > best) out.set(day, value)
  }
  return out
}

function r(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

export function buildDailyMetrics(c: HealthCollector): DailyMetricRow[] {
  const rows: DailyMetricRow[] = []
  const add = (date: string, metric: string, value: number): void => {
    if (Number.isFinite(value)) rows.push({ date, metric, value })
  }

  for (const [metric, acc] of Object.entries(c.means)) {
    for (const [day, [sum, n]] of acc) add(dateOfDayNumber(day), metric, r(sum / n, 2))
  }
  for (const [metric, acc] of Object.entries(c.lasts)) {
    for (const [day, [, value]] of acc) add(dateOfDayNumber(day), metric, r(value, 2))
  }

  for (const [day, steps] of largestSourcePerDay(c.stepsByDaySource)) {
    if (steps > 0) add(dateOfDayNumber(day), 'steps', Math.round(steps))
  }

  // Active energy: Apple's own daily summary where there is one, else the largest source's records.
  const kcal = new Map<string, number>()
  for (const [day, value] of largestSourcePerDay(c.activeKcalByDaySource)) {
    if (value > 0) kcal.set(dateOfDayNumber(day), value)
  }
  for (const [date, value] of c.activitySummaryKcal) kcal.set(date, value)
  for (const [date, value] of kcal) add(date, 'active_kcal', r(value, 1))

  for (const night of attributeSleep(c.sleep)) {
    add(night.date, 'sleep_hours', r(night.hours, 3))
    if (night.deepHours !== null) add(night.date, 'sleep_deep_hours', r(night.deepHours, 3))
    if (night.remHours !== null) add(night.date, 'sleep_rem_hours', r(night.remHours, 3))
    if (night.coreHours !== null) add(night.date, 'sleep_core_hours', r(night.coreHours, 3))
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : 0))
  return rows
}
