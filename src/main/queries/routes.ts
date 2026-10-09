import type { RangeKey } from '@shared/dates'
import type { LonLat, RouteArea, RouteGroup, RouteRun, RoutesData } from '@shared/api/routes'
import type { Db } from '../db'
import { groupTracks, offsetBetween, thinTrack, type Grouping } from './routes-grouping'
import { all, bounds, get, stream, SUMMARY_COLS, toSummary, type SummaryRow } from './util'

/** Tracks are thinned to this tolerance for the overview map: about a pixel at street zoom. */
const MAP_TOLERANCE_M = 3

/** Everything derived from the tracks alone. It only changes with an import. */
interface Geometry {
  signature: string
  grouping: Grouping
  /** workout id -> thinned track */
  coords: Map<number, LonLat[]>
}

// Comparing every track with every other is the one costly step of this page (a quarter of a
// second for 300 runs), and the result is the same for every date range, so it is kept per
// database until the stored routes change.
const cache = new WeakMap<Db, Geometry>()

function geometry(db: Db): Geometry {
  const sig = get<{ n: number; bytes: number; maxId: number; importId: number }>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes, COALESCE(MAX(workout_id), 0) AS maxId,
            (SELECT COALESCE(MAX(id), 0) FROM imports) AS importId
     FROM streams WHERE kind = 'route'`
  )
  const signature = JSON.stringify(sig)
  const cached = cache.get(db)
  if (cached?.signature === signature) return cached

  const ids = all<{ id: number }>(db, "SELECT id FROM workouts_v WHERE sport = 'run' AND has_route = 1 ORDER BY start_ts, id")
  const coords = new Map<number, LonLat[]>()
  const tracks = ids.map(({ id }) => {
    const points = stream<(number | null)[]>(db, id, 'route')
    coords.set(id, thinTrack(points, MAP_TOLERANCE_M))
    return { id, coords: points }
  })
  const fresh: Geometry = { signature, grouping: groupTracks(tracks), coords }
  cache.set(db, fresh)
  return fresh
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function getRoutes(db: Db, range: RangeKey): RoutesData {
  const { from, to } = bounds(db, range)
  const { grouping, coords } = geometry(db)

  // Every GPS run ever recorded: a route's description uses all of its runs, not just the ones in range.
  const rows = all<SummaryRow>(
    db,
    `SELECT ${SUMMARY_COLS} FROM workouts_v WHERE sport = 'run' AND has_route = 1 ORDER BY start_ts, id`
  )
  const byId = new Map(rows.map((r) => [r.id, toSummary(r)]))
  const inRange = (id: number): boolean => {
    const w = byId.get(id)
    return w !== undefined && w.date >= from && w.date <= to
  }

  const groupOf = new Map<number, number>()
  const groups: RouteGroup[] = []
  for (const g of grouping.groups) {
    const members = g.ids.flatMap((id) => byId.get(id) ?? [])
    const current = members.filter((w) => inRange(w.id))
    if (current.length === 0) continue
    const key = g.ids[0]
    for (const w of current) groupOf.set(w.id, key)
    const distances = members.flatMap((w) => w.distanceM ?? [])
    const paces = current.flatMap((w) => w.paceSPerKm ?? [])
    groups.push({
      key,
      area: g.area,
      shape: g.shape,
      heading: g.heading,
      distanceM: distances.length ? median(distances) : g.lengthM,
      outline: coords.get(g.representativeId) ?? [],
      runs: current.length,
      bestPaceSPerKm: paces.length ? Math.min(...paces) : null,
      lastDate: current.reduce((d, w) => (w.date > d ? w.date : d), current[0].date)
    })
  }
  groups.sort((a, b) => b.runs - a.runs || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.key - b.key))

  const runs: RouteRun[] = []
  for (const [id, workout] of byId) {
    const group = groupOf.get(id)
    const track = coords.get(id)
    if (group !== undefined && track) runs.push({ workout, coords: track, group })
  }

  const areas: RouteArea[] = []
  grouping.areas.forEach((a, key) => {
    const n = a.ids.filter((id) => groupOf.has(id)).length
    if (n === 0) return
    areas.push({ key, runs: n, offset: key === 0 ? null : offsetBetween(grouping.areas[0].center, a.center) })
  })
  areas.sort((a, b) => b.runs - a.runs || a.key - b.key)

  const runCount =
    get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM workouts_v WHERE sport = 'run' AND local_date BETWEEN ? AND ?", from, to)?.n ?? 0

  return {
    from,
    to,
    runCount,
    mappedDistanceM: runs.reduce((sum, r) => sum + (r.workout.distanceM ?? 0), 0),
    runs,
    groups,
    areas
  }
}
