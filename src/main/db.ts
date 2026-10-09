import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

// Bump when SCHEMA changes shape. Everything except user edits is rebuilt from
// the export on the next import, so a version change simply drops the derived tables.
const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workouts (
  id               INTEGER PRIMARY KEY,
  uid              TEXT NOT NULL UNIQUE,   -- stable across re-imports: activity_type|start_ts|source
  sport            TEXT NOT NULL,          -- Sport in src/shared/domain.ts
  activity_type    TEXT NOT NULL,          -- HealthKit type without prefix, e.g. 'Running'
  category         TEXT NOT NULL,          -- derived Category; read via the workouts_v view
  title            TEXT,                   -- Runna's title (HKWorkoutBrandName), shown as-is
  source           TEXT NOT NULL,          -- sourceName, trimmed
  start_ts         INTEGER NOT NULL,       -- unix seconds
  end_ts           INTEGER NOT NULL,
  tz_offset_min    INTEGER NOT NULL,       -- UTC offset of the export timestamp, e.g. 120
  local_date       TEXT NOT NULL,          -- YYYY-MM-DD the workout started on, local time
  duration_s       REAL NOT NULL,          -- active time as reported by HealthKit
  distance_m       REAL,
  energy_kcal      REAL,
  avg_hr           REAL,
  min_hr           REAL,
  max_hr           REAL,
  avg_power_w      REAL,
  avg_stride_m     REAL,
  avg_gct_ms       REAL,                   -- ground contact time
  avg_vert_osc_cm  REAL,                   -- vertical oscillation
  step_count       REAL,
  elevation_gain_m REAL,
  effort           REAL,                   -- Apple effort score 1-10
  indoor           INTEGER NOT NULL DEFAULT 0,
  user_entered     INTEGER NOT NULL DEFAULT 0,
  has_route        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS workouts_date ON workouts(local_date);
CREATE INDEX IF NOT EXISTS workouts_sport_date ON workouts(sport, local_date);

-- Laps as recorded by the source app (Runna: one per plan step or km).
CREATE TABLE IF NOT EXISTS laps (
  workout_id     INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  start_offset_s REAL NOT NULL,
  duration_s     REAL NOT NULL,
  distance_m     REAL,
  avg_hr         REAL,
  PRIMARY KEY (workout_id, idx)
);

-- Per-kilometre splits computed from the distance stream. The last split may be partial.
CREATE TABLE IF NOT EXISTS splits (
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  distance_m REAL NOT NULL,
  duration_s REAL NOT NULL,
  avg_hr     REAL,
  PRIMARY KEY (workout_id, idx)
);

-- Time in heart-rate zones as computed by Apple (WorkoutZoneGroup). zone is 1-based.
CREATE TABLE IF NOT EXISTS hr_zones (
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  zone       INTEGER NOT NULL,
  min_bpm    REAL,
  max_bpm    REAL,
  seconds    REAL NOT NULL,
  PRIMARY KEY (workout_id, zone)
);

-- Fastest continuous effort over a fixed distance inside one run.
CREATE TABLE IF NOT EXISTS best_efforts (
  workout_id     INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  distance_m     INTEGER NOT NULL,
  duration_s     REAL NOT NULL,
  start_offset_s REAL NOT NULL,
  PRIMARY KEY (workout_id, distance_m)
);

-- Time series as JSON arrays; offsets are seconds from workout start.
--   hr     [[t, bpm], ...]
--   dist   [[t, cumulative metres], ...]
--   power  [[t, watts], ...]
--   route  [[lon, lat, elevation m, t], ...]   (downsampled)
CREATE TABLE IF NOT EXISTS streams (
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (workout_id, kind)
);

-- One value per day and metric: resting_hr, hrv_sdnn, vo2max, weight_kg, sleep_hours,
-- sleep_deep_hours, sleep_rem_hours, sleep_core_hours, steps, active_kcal,
-- respiratory_rate, walking_hr_avg, hr_recovery_1min
CREATE TABLE IF NOT EXISTS daily_metrics (
  date   TEXT NOT NULL,
  metric TEXT NOT NULL,
  value  REAL NOT NULL,
  PRIMARY KEY (date, metric)
);

CREATE TABLE IF NOT EXISTS imports (
  id                 INTEGER PRIMARY KEY,
  file_name          TEXT NOT NULL,
  export_date        TEXT,
  imported_at        INTEGER NOT NULL,
  workouts_total     INTEGER NOT NULL,
  workouts_new       INTEGER NOT NULL,
  duplicates_skipped INTEGER NOT NULL,
  duration_ms        INTEGER NOT NULL
);

-- User edits. Keyed by uid, not id, so they survive a rebuild of the workouts table.
CREATE TABLE IF NOT EXISTS workout_overrides (
  uid      TEXT PRIMARY KEY,
  category TEXT NOT NULL
);

DROP VIEW IF EXISTS workouts_v;
CREATE VIEW workouts_v AS
  SELECT w.*, COALESCE(o.category, w.category) AS cat, o.category IS NOT NULL AS cat_overridden
  FROM workouts w LEFT JOIN workout_overrides o ON o.uid = w.uid;
`

const DERIVED_TABLES = ['streams', 'best_efforts', 'hr_zones', 'splits', 'laps', 'workouts', 'daily_metrics']

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (user_version !== SCHEMA_VERSION) {
    db.exec('DROP VIEW IF EXISTS workouts_v;')
    for (const t of DERIVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${t};`)
  }
  db.exec(SCHEMA)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
  return db
}

/** Default database location outside a packaged app. FD_DB overrides it. */
export function devDbPath(): string {
  return process.env.FD_DB ?? `${process.cwd()}/data/fitness.db`
}
