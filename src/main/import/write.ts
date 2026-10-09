// Replaces everything derived from the export in one transaction.
import type { Db } from '../db'
import type { DailyMetricRow, WorkoutRecord } from './types'

export interface ImportLogEntry {
  fileName: string
  exportDate: string | null
  /** Milliseconds since the epoch. */
  importedAt: number
  duplicatesSkipped: number
  /** Time spent before the write started; the write's own duration is added. */
  startedAt: number
}

export interface WriteResult {
  workoutsTotal: number
  workoutsNew: number
  durationMs: number
}

/** Children first, so that the deletes never depend on cascading. */
const DERIVED_TABLES = ['streams', 'best_efforts', 'hr_zones', 'splits', 'laps', 'workouts', 'daily_metrics'] as const

/**
 * Clears and rebuilds the derived tables, leaves workout_overrides alone and appends a row
 * to imports. `workouts` must be in a stable order: ids are assigned by position, so the
 * same export always produces the same rows.
 */
export function writeImport(db: Db, workouts: WorkoutRecord[], daily: DailyMetricRow[], log: ImportLogEntry): WriteResult {
  const bool = (v: boolean): number => (v ? 1 : 0)
  db.exec('BEGIN IMMEDIATE')
  try {
    const before = new Set((db.prepare('SELECT uid FROM workouts').all() as { uid: string }[]).map((r) => r.uid))
    for (const table of DERIVED_TABLES) db.exec(`DELETE FROM ${table}`)

    const insWorkout = db.prepare(
      `INSERT INTO workouts (
         id, uid, sport, activity_type, category, title, source, start_ts, end_ts, tz_offset_min, local_date,
         duration_s, distance_m, energy_kcal, avg_hr, min_hr, max_hr, avg_power_w, avg_stride_m, avg_gct_ms,
         avg_vert_osc_cm, step_count, elevation_gain_m, effort, indoor, user_entered, has_route
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insLap = db.prepare('INSERT INTO laps (workout_id, idx, start_offset_s, duration_s, distance_m, avg_hr) VALUES (?, ?, ?, ?, ?, ?)')
    const insSplit = db.prepare('INSERT INTO splits (workout_id, idx, distance_m, duration_s, avg_hr) VALUES (?, ?, ?, ?, ?)')
    const insZone = db.prepare('INSERT INTO hr_zones (workout_id, zone, min_bpm, max_bpm, seconds) VALUES (?, ?, ?, ?, ?)')
    const insEffort = db.prepare('INSERT INTO best_efforts (workout_id, distance_m, duration_s, start_offset_s) VALUES (?, ?, ?, ?)')
    const insStream = db.prepare('INSERT INTO streams (workout_id, kind, data) VALUES (?, ?, ?)')
    const insDaily = db.prepare('INSERT INTO daily_metrics (date, metric, value) VALUES (?, ?, ?)')

    let workoutsNew = 0
    workouts.forEach((w, i) => {
      const id = i + 1
      if (!before.has(w.uid)) workoutsNew++
      insWorkout.run(
        id,
        w.uid,
        w.sport,
        w.activityType,
        w.category,
        w.title,
        w.source,
        w.startTs,
        w.endTs,
        w.tzOffsetMin,
        w.localDate,
        w.durationS,
        w.distanceM,
        w.energyKcal,
        w.avgHr,
        w.minHr,
        w.maxHr,
        w.avgPowerW,
        w.avgStrideM,
        w.avgGctMs,
        w.avgVertOscCm,
        w.stepCount,
        w.elevationGainM,
        w.effort,
        bool(w.indoor),
        bool(w.userEntered),
        bool(w.hasRoute)
      )
      for (const l of w.laps) insLap.run(id, l.idx, l.startOffsetS, l.durationS, l.distanceM, l.avgHr)
      for (const s of w.splits) insSplit.run(id, s.idx, s.distanceM, s.durationS, s.avgHr)
      w.zones.forEach((z, zi) => insZone.run(id, zi + 1, z.minBpm, z.maxBpm, z.seconds))
      for (const b of w.bestEfforts) insEffort.run(id, b.distanceM, b.durationS, b.startOffsetS)
      for (const kind of Object.keys(w.streams).sort()) insStream.run(id, kind, JSON.stringify(w.streams[kind]))
    })
    for (const d of daily) insDaily.run(d.date, d.metric, d.value)

    const durationMs = Date.now() - log.startedAt
    db.prepare(
      `INSERT INTO imports (file_name, export_date, imported_at, workouts_total, workouts_new, duplicates_skipped, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(log.fileName, log.exportDate, log.importedAt, workouts.length, workoutsNew, log.duplicatesSkipped, durationMs)
    db.exec('COMMIT')
    return { workoutsTotal: workouts.length, workoutsNew, durationMs }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
