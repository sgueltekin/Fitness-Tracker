import type { WorkoutSummary } from '@shared/api/common'
import { rangeBounds, todayYmd, type RangeBounds, type RangeKey } from '@shared/dates'
import { workoutName, type Category, type Sport } from '@shared/domain'
import { paceFrom } from '@shared/format'
import type { Db } from '../db'

type Param = string | number | null

export function all<T>(db: Db, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

export function get<T>(db: Db, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

/** Date bounds of a range; 'all' starts at the first workout. */
export function bounds(db: Db, range: RangeKey): RangeBounds {
  const first = get<{ d: string | null }>(db, 'SELECT MIN(local_date) AS d FROM workouts')
  return rangeBounds(range, todayYmd(), first?.d)
}

/** Column list for WorkoutSummary rows. Select it FROM workouts_v, then map with toSummary. */
export const SUMMARY_COLS =
  'id, sport, cat, title, local_date, start_ts, tz_offset_min, duration_s, distance_m, avg_hr, has_route'

export interface SummaryRow {
  id: number
  sport: Sport
  cat: Category
  title: string | null
  local_date: string
  start_ts: number
  tz_offset_min: number
  duration_s: number
  distance_m: number | null
  avg_hr: number | null
  has_route: number
}

export function toSummary(r: SummaryRow): WorkoutSummary {
  const distanceSport = r.sport === 'run' || r.sport === 'walk'
  return {
    id: r.id,
    sport: r.sport,
    category: r.cat,
    name: workoutName({ title: r.title, sport: r.sport, category: r.cat }),
    date: r.local_date,
    startTs: r.start_ts,
    tzOffsetMin: r.tz_offset_min,
    durationS: r.duration_s,
    distanceM: r.distance_m,
    avgHr: r.avg_hr,
    paceSPerKm: distanceSport ? paceFrom(r.distance_m, r.duration_s) : null,
    hasRoute: r.has_route === 1
  }
}

/** Parses a JSON stream column; returns [] for missing rows. */
export function stream<T = number[]>(db: Db, workoutId: number, kind: string): T[] {
  const row = get<{ data: string }>(db, 'SELECT data FROM streams WHERE workout_id = ? AND kind = ?', workoutId, kind)
  return row ? (JSON.parse(row.data) as T[]) : []
}
