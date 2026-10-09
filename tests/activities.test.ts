import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db'
import { getActivities, getWorkout, gridStep, resample, setWorkoutCategory } from '../src/main/queries/activities'

// All workouts here are made up.
interface Seed {
  uid: string
  sport: string
  category: string
  title?: string | null
  date: string
  startTs: number
  durationS?: number
  distanceM?: number | null
  avgHr?: number | null
}

function insert(db: Db, w: Seed): number {
  const durationS = w.durationS ?? 1800
  const res = db
    .prepare(
      `INSERT INTO workouts (uid, sport, activity_type, category, title, source, start_ts, end_ts, tz_offset_min, local_date,
                             duration_s, distance_m, avg_hr)
       VALUES (?, ?, 'Test', ?, ?, 'Test app', ?, ?, 120, ?, ?, ?, ?)`
    )
    .run(w.uid, w.sport, w.category, w.title ?? null, w.startTs, w.startTs + durationS, w.date, durationS, w.distanceM ?? null, w.avgHr ?? null)
  return Number(res.lastInsertRowid)
}

let db: Db
let easyRun: number
let untitledRun: number
let gym: number

beforeEach(() => {
  db = openDatabase(':memory:')
  easyRun = insert(db, { uid: 'run-a', sport: 'run', category: 'easy', title: '5 km Dauerlauf', date: '2026-03-02', startTs: 1_000_000, distanceM: 5000, avgHr: 140 })
  untitledRun = insert(db, { uid: 'run-b', sport: 'run', category: 'other', date: '2026-03-04', startTs: 1_200_000, distanceM: 3000 })
  gym = insert(db, { uid: 'gym-a', sport: 'strength', category: 'strength', title: 'Rücken', date: '2025-11-20', startTs: 500_000, durationS: 3600 })
  insert(db, { uid: 'gym-b', sport: 'strength', category: 'strength', date: '2026-03-05', startTs: 1_300_000, durationS: 2400 })
})

describe('setWorkoutCategory', () => {
  it('stores an override, replaces it and clears it', () => {
    expect(getWorkout(db, easyRun)).toMatchObject({ summary: { category: 'easy' }, categoryOverridden: false, autoCategory: 'easy', categoryEditable: true })

    setWorkoutCategory(db, easyRun, 'tempo')
    expect(getWorkout(db, easyRun)).toMatchObject({ summary: { category: 'tempo' }, categoryOverridden: true, autoCategory: 'easy' })
    expect(getActivities(db, {}).rows.find((w) => w.id === easyRun)?.category).toBe('tempo')

    setWorkoutCategory(db, easyRun, 'long')
    expect(getWorkout(db, easyRun)?.summary.category).toBe('long')
    expect(db.prepare('SELECT COUNT(*) AS n FROM workout_overrides').get()).toEqual({ n: 1 })

    setWorkoutCategory(db, easyRun, null)
    expect(getWorkout(db, easyRun)).toMatchObject({ summary: { category: 'easy' }, categoryOverridden: false })
    expect(db.prepare('SELECT COUNT(*) AS n FROM workout_overrides').get()).toEqual({ n: 0 })
  })

  it('keeps the override when an import gives the workout a new id', () => {
    setWorkoutCategory(db, easyRun, 'intervals')
    db.prepare('DELETE FROM workouts WHERE id = ?').run(easyRun)
    const reimported = insert(db, { uid: 'run-a', sport: 'run', category: 'easy', title: '5 km Dauerlauf', date: '2026-03-02', startTs: 1_000_000, distanceM: 5000 })
    expect(reimported).not.toBe(easyRun)
    expect(getWorkout(db, reimported)).toMatchObject({ summary: { category: 'intervals' }, categoryOverridden: true })
  })

  it('names an untitled run after its override', () => {
    expect(getWorkout(db, untitledRun)?.summary.name).toBe('Run')
    setWorkoutCategory(db, untitledRun, 'long')
    expect(getWorkout(db, untitledRun)?.summary.name).toBe('Long run')
  })

  it('refuses workouts that are not runs, unknown ids and unknown types', () => {
    expect(() => setWorkoutCategory(db, gym, 'easy')).toThrow(/Only runs/)
    expect(() => setWorkoutCategory(db, 9999, 'easy')).toThrow(/does not exist/)
    expect(() => setWorkoutCategory(db, easyRun, 'strength' as never)).toThrow(/Unknown run type/)
    expect(db.prepare('SELECT COUNT(*) AS n FROM workout_overrides').get()).toEqual({ n: 0 })
    // Clearing is harmless everywhere.
    expect(() => setWorkoutCategory(db, gym, null)).not.toThrow()
  })
})

describe('getActivities', () => {
  it('lists everything newest first with totals', () => {
    const a = getActivities(db, {})
    expect(a.rows.map((w) => w.date)).toEqual(['2026-03-05', '2026-03-04', '2026-03-02', '2025-11-20'])
    expect(a).toMatchObject({ total: 4, allCount: 4, firstDate: '2025-11-20', totalDistanceM: 8000, totalDurationS: 9600, sports: ['run', 'strength'] })
  })

  it('filters by sport', () => {
    const a = getActivities(db, { sport: 'run' })
    expect(a.rows.map((w) => w.id)).toEqual([untitledRun, easyRun])
    expect(a).toMatchObject({ total: 2, allCount: 4, totalDistanceM: 8000 })
    expect(getActivities(db, { sport: 'all' }).total).toBe(4)
    expect(getActivities(db, { sport: 'swim' })).toMatchObject({ total: 0, rows: [], totalDurationS: 0 })
  })

  it('searches titles, generated names, type labels and dates, ignoring case and accents', () => {
    const ids = (search: string): number[] => getActivities(db, { search }).rows.map((w) => w.id)
    expect(ids('dauerlauf')).toEqual([easyRun])
    expect(ids('  RUCKEN ')).toEqual([gym])
    expect(ids('gym session')).toHaveLength(1)
    expect(ids('easy run')).toEqual([easyRun])
    expect(ids('2025')).toEqual([gym])
    expect(ids('4 mar 2026')).toEqual([untitledRun])
    expect(ids('no such thing')).toEqual([])
    expect(getActivities(db, { search: 'gym', sport: 'run' }).total).toBe(0)
  })

  it('pages without changing the totals', () => {
    const page = getActivities(db, { limit: 2, offset: 1 })
    expect(page.rows.map((w) => w.date)).toEqual(['2026-03-04', '2026-03-02'])
    expect(page).toMatchObject({ total: 4, totalDurationS: 9600 })
    expect(getActivities(db, { limit: 2, offset: 3 }).rows).toHaveLength(1)
  })
})

describe('getWorkout', () => {
  it('returns null for ids that do not exist or are not ids', () => {
    expect(getWorkout(db, 9999)).toBeNull()
    expect(getWorkout(db, 1.5)).toBeNull()
    expect(getWorkout(db, Number.NaN)).toBeNull()
  })

  it('reports missing measurements as null or empty, never as zero', () => {
    expect(getWorkout(db, gym)).toMatchObject({
      categoryEditable: false,
      energyKcal: null,
      maxHr: null,
      avgPowerW: null,
      cadenceSpm: null,
      elevationGainM: null,
      effort: null,
      bestKmS: null,
      laps: [],
      splits: [],
      zones: [],
      route: [],
      series: { hr: null, powerW: null, elevationM: null }
    })
  })

  it('reads laps, zones and streams, and gives a stop-button lap no pace', () => {
    db.prepare('INSERT INTO laps (workout_id, idx, start_offset_s, duration_s, distance_m, avg_hr) VALUES (?, 1, 0, 300, 1000, 140), (?, 2, 300, 8, 3, 150)').run(easyRun, easyRun)
    db.prepare('INSERT INTO hr_zones (workout_id, zone, min_bpm, max_bpm, seconds) VALUES (?, 1, NULL, 130, 100), (?, 2, 130, NULL, 0)').run(easyRun, easyRun)
    const hr = Array.from({ length: 361 }, (_, i) => [i * 5, 120 + (i % 2)])
    // Constant altitude: a route, but no elevation profile.
    const route = [[10, 50, 80, 0], [10.001, 50.001, 80, 900], [10.002, 50.002, 80, 1800]]
    const put = db.prepare('INSERT INTO streams (workout_id, kind, data) VALUES (?, ?, ?)')
    put.run(easyRun, 'hr', JSON.stringify(hr))
    put.run(easyRun, 'route', JSON.stringify(route))

    const w = getWorkout(db, easyRun)!
    expect(w.laps).toEqual([
      { idx: 1, distanceM: 1000, durationS: 300, paceSPerKm: 300, avgHr: 140 },
      { idx: 2, distanceM: 3, durationS: 8, paceSPerKm: null, avgHr: 150 }
    ])
    expect(w.zones).toEqual([
      { zone: 1, minBpm: null, maxBpm: 130, seconds: 100 },
      { zone: 2, minBpm: 130, maxBpm: null, seconds: 0 }
    ])
    expect(w.route).toEqual([[10, 50], [10.001, 50.001], [10.002, 50.002]])
    expect(w.series.stepS).toBe(10)
    expect(w.series.hr).toHaveLength(181)
    expect(w.series.hr!.every((v) => v === 120 || v === 121)).toBe(true)
    expect(w.series.elevationM).toBeNull()
  })

  it('does not turn a few background readings into a heart-rate trace', () => {
    db.prepare('INSERT INTO streams (workout_id, kind, data) VALUES (?, ?, ?)').run(gym, 'hr', JSON.stringify([[20, 90], [900, 100], [2000, 95], [3400, 88]]))
    expect(getWorkout(db, gym)?.series.hr).toBeNull()
  })
})

describe('resample', () => {
  it('averages the samples around each grid point', () => {
    expect(resample([[0, 100], [4, 110], [8, 120], [12, 130], [20, 150]], 10, 3)).toEqual([105, 125, 150])
  })

  it('interpolates across a short hole and leaves a long one empty', () => {
    const steady: [number, number][] = Array.from({ length: 11 }, (_, i) => [i * 5, 100])
    const afterShortHole: [number, number][] = [[80, 130], [85, 130]]
    expect(resample([...steady, ...afterShortHole], 10, 9)).toEqual([100, 100, 100, 100, 100, 100, 110, 120, 130])
    const afterLongHole: [number, number][] = [[200, 130], [205, 130]]
    const out = resample([...steady, ...afterLongHole], 10, 21)!
    expect(out.slice(6, 20)).toEqual(Array(14).fill(null))
    expect(out[20]).toBe(130)
  })

  it('is empty before the first and after the last sample, and null without a series', () => {
    expect(resample([[20, 100], [24, 100]], 10, 5)).toEqual([null, null, 100, null, null])
    expect(resample([[0, 100]], 10, 3)).toBeNull()
    expect(resample([], 10, 3)).toBeNull()
  })

  it('keeps a series at 300 points or fewer', () => {
    expect(gridStep(600)).toBe(5)
    expect(gridStep(3600)).toBe(15)
    expect(gridStep(3 * 3600)).toBe(60)
  })
})
