import type {
  ActivitiesData,
  ActivitiesQuery,
  HrZone,
  WorkoutDetail,
  WorkoutSegment,
  WorkoutSeries
} from '@shared/api/activities'
import { CATEGORY_LABEL, RUN_CATEGORIES, defaultCategory, measuredEnergyKcal, type RunCategory, type Sport } from '@shared/domain'
import { fmtDateYear, paceFrom } from '@shared/format'
import type { Db } from '../db'
import { SUMMARY_COLS, all, get, stream, toSummary, type SummaryRow } from './util'

const SPORT_ORDER: Sport[] = ['run', 'strength', 'swim', 'walk', 'cycle', 'other']

/** Lower case, accents stripped, whitespace collapsed: 'Brust  Rücken' -> 'brust rucken'. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function getActivities(db: Db, query: ActivitiesQuery): ActivitiesData {
  // Search has to see generated names ('Gym session') and type labels, which only exist after
  // toSummary, so filtering and paging happen here rather than in SQL. The table is one person's
  // training history: a few thousand rows at most.
  const everything = all<SummaryRow>(db, `SELECT ${SUMMARY_COLS} FROM workouts_v ORDER BY start_ts DESC, id DESC`).map(toSummary)

  const sport = query.sport && query.sport !== 'all' ? query.sport : null
  const needle = normalize(query.search ?? '')
  const matches = everything.filter((w) => {
    if (sport && w.sport !== sport) return false
    if (!needle) return true
    return [w.name, CATEGORY_LABEL[w.category], fmtDateYear(w.date)].some((text) => normalize(text).includes(needle))
  })

  const offset = Math.max(0, Math.floor(query.offset ?? 0))
  const end = query.limit == null ? undefined : offset + Math.max(0, Math.floor(query.limit))
  const present = new Set(everything.map((w) => w.sport))

  return {
    rows: matches.slice(offset, end),
    total: matches.length,
    totalDistanceM: matches.reduce((sum, w) => sum + (w.distanceM ?? 0), 0),
    totalDurationS: matches.reduce((sum, w) => sum + w.durationS, 0),
    allCount: everything.length,
    firstDate: everything.length > 0 ? everything[everything.length - 1].date : null,
    sports: SPORT_ORDER.filter((s) => present.has(s))
  }
}

interface DetailRow extends SummaryRow {
  source: string
  end_ts: number
  energy_kcal: number | null
  min_hr: number | null
  max_hr: number | null
  avg_power_w: number | null
  avg_stride_m: number | null
  avg_gct_ms: number | null
  avg_vert_osc_cm: number | null
  step_count: number | null
  elevation_gain_m: number | null
  effort: number | null
  indoor: number
  user_entered: number
  cat_overridden: number
}

interface SegmentRow {
  idx: number
  distance_m: number | null
  duration_s: number
  avg_hr: number | null
}

/** Below this a segment is a stop-button artefact; its pace would be noise. */
const MIN_PACE_DISTANCE_M = 20

function toSegment(r: SegmentRow): WorkoutSegment {
  return {
    idx: r.idx,
    distanceM: r.distance_m,
    durationS: r.duration_s,
    paceSPerKm: (r.distance_m ?? 0) >= MIN_PACE_DISTANCE_M ? paceFrom(r.distance_m, r.duration_s) : null,
    avgHr: r.avg_hr
  }
}

type Pt = [number, number]

/** Grid step in seconds that keeps a series at 300 points or fewer. */
export function gridStep(elapsedS: number): number {
  return [5, 10, 15, 20, 30, 60, 120, 300].find((s) => elapsedS / s <= 300) ?? 600
}

/**
 * Puts irregular [t, value] samples on a regular grid of `count` points, `stepS` apart.
 * A grid point takes the mean of the samples within half a step of it. Where there are none it is
 * interpolated between its neighbours, unless they are further apart than the stream's usual
 * rhythm allows (a paused watch, a lost signal): then it stays null and the line breaks.
 * Returns null for fewer than two samples.
 */
export function resample(points: Pt[], stepS: number, count: number, digits = 0): (number | null)[] | null {
  const pts = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (pts.length < 2) return null

  const gaps = pts.slice(1).map((p, i) => p[0] - pts[i][0]).sort((a, b) => a - b)
  const maxGap = Math.max(60, 8 * gaps[Math.floor(gaps.length / 2)])
  const scale = 10 ** digits
  const round = (v: number): number => Math.round(v * scale) / scale

  const out: (number | null)[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    const at = i * stepS
    while (p < pts.length && pts[p][0] < at - stepS / 2) p++
    let sum = 0
    let n = 0
    let q = p
    for (; q < pts.length && pts[q][0] < at + stepS / 2; q++) {
      sum += pts[q][1]
      n++
    }
    if (n > 0) {
      out.push(round(sum / n))
      continue
    }
    const before = pts[p - 1]
    const after = pts[q]
    if (before && after && after[0] - before[0] <= maxGap) {
      out.push(round(before[1] + ((after[1] - before[1]) * (at - before[0])) / (after[0] - before[0])))
    } else {
      out.push(null)
    }
  }
  return out
}

function series(db: Db, id: number, elapsedS: number): WorkoutSeries {
  const stepS = gridStep(elapsedS)
  const count = Math.floor(elapsedS / stepS) + 1
  // Routes without timestamps or with a constant altitude carry no elevation profile.
  const altitude = stream<(number | null)[]>(db, id, 'route')
    .filter((p) => p[2] != null && p[3] != null)
    .map((p): Pt => [p[3] as number, p[2] as number])
  const varies = altitude.some((p) => p[1] !== altitude[0][1])
  // A hand-entered session still picks up the watch's background readings, a handful per hour.
  // Joined into a line they would pass for a recording, so a stream needs a sample a minute to count.
  const recorded = (kind: string): Pt[] => {
    const pts = stream<Pt>(db, id, kind)
    return pts.length >= elapsedS / 60 ? pts : []
  }
  return {
    stepS,
    hr: resample(recorded('hr'), stepS, count),
    powerW: resample(recorded('power'), stepS, count),
    elevationM: varies ? resample(altitude, stepS, count, 1) : null
  }
}

export function getWorkout(db: Db, id: number): WorkoutDetail | null {
  if (!Number.isInteger(id)) return null
  const r = get<DetailRow>(
    db,
    `SELECT ${SUMMARY_COLS}, source, end_ts, energy_kcal, min_hr, max_hr, avg_power_w, avg_stride_m, avg_gct_ms,
            avg_vert_osc_cm, step_count, elevation_gain_m, effort, indoor, user_entered, cat_overridden
     FROM workouts_v WHERE id = ?`,
    id
  )
  if (!r) return null

  const elapsedS = Math.max(r.end_ts - r.start_ts, r.duration_s)
  const onFoot = r.sport === 'run' || r.sport === 'walk'
  const bestKm = get<{ duration_s: number }>(db, 'SELECT duration_s FROM best_efforts WHERE workout_id = ? AND distance_m = 1000', id)

  return {
    summary: toSummary(r),
    source: r.source,
    indoor: r.indoor === 1,
    userEntered: r.user_entered === 1,
    elapsedS,

    categoryEditable: r.sport === 'run',
    categoryOverridden: r.cat_overridden === 1,
    // The same derivation the importer stores; recomputed so the stored column stays behind the view.
    autoCategory: defaultCategory(r.sport, r.title),

    energyKcal: measuredEnergyKcal(r.energy_kcal, r.duration_s),
    minHr: r.min_hr,
    maxHr: r.max_hr,
    avgPowerW: r.avg_power_w,
    avgStrideM: r.avg_stride_m,
    avgGctMs: r.avg_gct_ms,
    avgVertOscCm: r.avg_vert_osc_cm,
    stepCount: r.step_count,
    cadenceSpm: onFoot && r.step_count && r.duration_s > 0 ? r.step_count / (r.duration_s / 60) : null,
    elevationGainM: r.elevation_gain_m,
    effort: r.effort,
    bestKmS: bestKm?.duration_s ?? null,

    laps: all<SegmentRow>(db, 'SELECT idx, distance_m, duration_s, avg_hr FROM laps WHERE workout_id = ? ORDER BY idx', id).map(toSegment),
    splits: all<SegmentRow>(db, 'SELECT idx, distance_m, duration_s, avg_hr FROM splits WHERE workout_id = ? ORDER BY idx', id).map(toSegment),
    zones: all<{ zone: number; min_bpm: number | null; max_bpm: number | null; seconds: number }>(
      db,
      'SELECT zone, min_bpm, max_bpm, seconds FROM hr_zones WHERE workout_id = ? ORDER BY zone',
      id
    ).map((z): HrZone => ({ zone: z.zone, minBpm: z.min_bpm, maxBpm: z.max_bpm, seconds: z.seconds })),
    route: stream<number[]>(db, id, 'route').map((p): [number, number] => [p[0], p[1]]),
    series: series(db, id, elapsedS)
  }
}

/**
 * Stores a manual run type, or removes it with null. The override is keyed by the workout's uid,
 * because ids are reassigned on every import.
 */
export function setWorkoutCategory(db: Db, id: number, category: RunCategory | null): void {
  const w = get<{ uid: string; sport: Sport }>(db, 'SELECT uid, sport FROM workouts WHERE id = ?', id)
  if (!w) throw new Error(`Workout ${id} does not exist`)
  if (category === null) {
    db.prepare('DELETE FROM workout_overrides WHERE uid = ?').run(w.uid)
    return
  }
  if (w.sport !== 'run') throw new Error('Only runs can be given a different type')
  if (!RUN_CATEGORIES.includes(category)) throw new Error(`Unknown run type: ${String(category)}`)
  db.prepare(
    'INSERT INTO workout_overrides (uid, category) VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET category = excluded.category'
  ).run(w.uid, category)
}
