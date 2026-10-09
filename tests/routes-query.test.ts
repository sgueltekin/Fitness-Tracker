// getRoutes against an in-memory database filled with made-up runs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db'
import { getRoutes } from '../src/main/queries/routes'

const LON0 = 20
const LAT0 = 10
const M_PER_DEG = 111_320
const KX = M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)

type XY = [number, number]

/** A route stream with a point every 10 m along a path given in metres. */
function routeJson(xy: XY[]): string {
  const pts: (number | null)[][] = []
  let t = 0
  const push = (x: number, y: number): void => {
    pts.push([LON0 + x / KX, LAT0 + y / M_PER_DEG, 100, t++])
  }
  push(xy[0][0], xy[0][1])
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]
    const [bx, by] = xy[i]
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 10))
    for (let k = 1; k <= n; k++) push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)
  }
  return JSON.stringify(pts)
}

const LOOP: XY[] = [[0, 0], [1000, 0], [1000, 500], [0, 500], [0, 0]]
const LOOP_REVERSED: XY[] = [...LOOP].reverse() as XY[]
const STRAIGHT: XY[] = [[0, 0], [-2000, 0], [0, 0]]
const FAR_AWAY: XY[] = LOOP.map(([x, y]) => [x - 30_000, y])

interface Run {
  id: number
  date: string
  distanceM: number
  durationS: number
  route: XY[] | null
  sport?: string
}

// "Today" is pinned to Friday 9 Oct 2026: the 4-week range starts on Monday 14 Sep.
const RUNS: Run[] = [
  { id: 1, date: '2026-06-02', distanceM: 3000, durationS: 1200, route: LOOP },
  { id: 2, date: '2026-09-01', distanceM: 4000, durationS: 1500, route: STRAIGHT },
  { id: 3, date: '2026-09-20', distanceM: 3050, durationS: 1100, route: LOOP_REVERSED },
  { id: 4, date: '2026-09-25', distanceM: 5000, durationS: 1800, route: null }, // treadmill
  { id: 5, date: '2026-10-02', distanceM: 2990, durationS: 1300, route: LOOP },
  { id: 6, date: '2026-10-05', distanceM: 3000, durationS: 1000, route: FAR_AWAY },
  { id: 7, date: '2026-10-06', distanceM: 3000, durationS: 2400, route: LOOP, sport: 'walk' }
]

function insert(db: Db, r: Run): void {
  const startTs = Date.parse(`${r.date}T08:00:00Z`) / 1000
  db.prepare(
    `INSERT INTO workouts (id, uid, sport, activity_type, category, source, start_ts, end_ts, tz_offset_min, local_date, duration_s, distance_m, has_route)
     VALUES (?, ?, ?, 'Running', 'easy', 'Test Watch', ?, ?, 0, ?, ?, ?, ?)`
  ).run(r.id, `uid-${r.id}`, r.sport ?? 'run', startTs, startTs + r.durationS, r.date, r.durationS, r.distanceM, r.route ? 1 : 0)
  if (r.route) db.prepare("INSERT INTO streams (workout_id, kind, data) VALUES (?, 'route', ?)").run(r.id, routeJson(r.route))
}

describe('getRoutes', () => {
  let db: Db
  const before = process.env.FD_NOW

  beforeAll(() => {
    process.env.FD_NOW = '2026-10-09'
    db = openDatabase(':memory:')
    for (const r of RUNS) insert(db, r)
  })
  afterAll(() => {
    db.close()
    if (before === undefined) delete process.env.FD_NOW
    else process.env.FD_NOW = before
  })

  it('groups all GPS runs and counts the ones in range', () => {
    const d = getRoutes(db, 'all')
    expect(d.runCount).toBe(6) // the walk is not a run
    expect(d.runs.map((r) => r.workout.id)).toEqual([1, 2, 3, 5, 6])
    expect(d.mappedDistanceM).toBe(3000 + 4000 + 3050 + 2990 + 3000)
    expect(d.groups.map((g) => [g.key, g.runs, g.area])).toEqual([
      [1, 3, 0],
      [6, 1, 1],
      [2, 1, 0]
    ])
    const loop = d.groups[0]
    expect(loop.shape).toBe('loop')
    expect(loop.heading).toBe('NE')
    expect(loop.distanceM).toBe(3000)
    expect(loop.lastDate).toBe('2026-10-02')
    expect(loop.bestPaceSPerKm).toBeCloseTo(1100 / 3.05, 5)
    expect(d.runs.filter((r) => r.group === loop.key).map((r) => r.workout.id)).toEqual([1, 3, 5])
    expect(d.groups[2].shape).toBe('out-and-back')
    expect(d.groups[2].heading).toBe('W')
  })

  it('sends thinned [lon, lat] tracks', () => {
    const d = getRoutes(db, 'all')
    for (const r of d.runs) {
      expect(r.coords.length).toBeGreaterThanOrEqual(2)
      expect(r.coords.length).toBeLessThan(12)
      expect(r.coords[0]).toHaveLength(2)
    }
    expect(d.groups[0].outline.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps a route its key and description when the range leaves out some of its runs', () => {
    const d = getRoutes(db, '4w')
    expect(d.from).toBe('2026-09-14')
    expect(d.runCount).toBe(4)
    expect(d.runs.map((r) => r.workout.id)).toEqual([3, 5, 6])
    const loop = d.groups[0]
    expect([loop.key, loop.runs, loop.distanceM]).toEqual([1, 2, 3000]) // median over all three runs
    expect(loop.bestPaceSPerKm).toBeCloseTo(1100 / 3.05, 5)
    expect(d.groups.map((g) => g.key)).toEqual([1, 6]) // the straight route has no run in range
  })

  it('reports areas with runs in range, relative to the usual one', () => {
    const d = getRoutes(db, 'all')
    expect(d.areas.map((a) => [a.key, a.runs])).toEqual([
      [0, 4],
      [1, 1]
    ])
    expect(d.areas[0].offset).toBeNull()
    expect(d.areas[1].offset?.heading).toBe('W')
    expect((d.areas[1].offset?.distanceM ?? 0) / 1000).toBeGreaterThan(25)
  })

  it('regroups when a route is added', () => {
    insert(db, { id: 8, date: '2026-10-08', distanceM: 4100, durationS: 1500, route: STRAIGHT })
    const d = getRoutes(db, 'all')
    expect(d.groups.map((g) => [g.key, g.runs])).toEqual([
      [1, 3],
      [2, 2],
      [6, 1]
    ])
    expect(d.groups[1].distanceM).toBe(4050)
    db.prepare('DELETE FROM workouts WHERE id = 8').run()
    expect(getRoutes(db, 'all').groups.map((g) => g.runs)).toEqual([3, 1, 1])
  })

  it('returns empty lists when nothing in range has a route', () => {
    const empty = openDatabase(':memory:')
    insert(empty, { id: 1, date: '2026-10-01', distanceM: 5000, durationS: 1800, route: null })
    const d = getRoutes(empty, '12w')
    expect([d.runCount, d.runs, d.groups, d.areas, d.mappedDistanceM]).toEqual([1, [], [], [], 0])
    empty.close()
  })
})
