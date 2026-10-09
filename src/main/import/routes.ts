// Decides which workout a route file belongs to.
//
// Health names route files after the minute the route was saved
// (route_2024-01-31_6.05pm.gpx). When an app saves several routes at once (Strava
// back-filling older runs), their names collide and the export contains a single file that
// several workouts point to. Such a file is the route of at most one of them.
import { cumulativeDistanceM, trackExtentM, trackHasUsableTimes, type Track } from './gpx'
import type { RawWorkout } from './types'

/** A shared route is matched by length: within this share of the workout's distance. */
export const SHARED_ROUTE_TOLERANCE = 0.05

/**
 * Index of the workout a shared track belongs to, or -1 when that cannot be told: the
 * track's length must match exactly one of the workout distances.
 */
export function claimSharedRoute(trackLengthM: number, distancesM: (number | null)[], tolerance = SHARED_ROUTE_TOLERANCE): number {
  let match = -1
  for (let i = 0; i < distancesM.length; i++) {
    const d = distancesM[i]
    if (d === null || d <= 0) continue
    if (Math.abs(trackLengthM - d) / d <= tolerance) {
      if (match !== -1) return -1
      match = i
    }
  }
  return match
}

/** A track that stays within this many metres is a workout on the spot, not a route. */
export const MIN_ROUTE_EXTENT_M = 50

/**
 * workout -> its track, for every workout whose route file exists, goes somewhere and is
 * unambiguously its own. Indoor workouts get no route: apps write a file of identical
 * points for a treadmill run.
 */
export function assignRoutes(workouts: RawWorkout[], tracks: Map<string, Track>): Map<RawWorkout, Track> {
  const byPath = new Map<string, RawWorkout[]>()
  for (const w of workouts) {
    if (!w.routePath) continue
    const track = tracks.get(w.routePath)
    if (!track || track.lon.length < 2 || w.indoor || trackExtentM(track) < MIN_ROUTE_EXTENT_M) continue
    const list = byPath.get(w.routePath)
    if (list) list.push(w)
    else byPath.set(w.routePath, [w])
  }

  const out = new Map<RawWorkout, Track>()
  for (const [path, users] of byPath) {
    const track = tracks.get(path) as Track
    if (users.length === 1) {
      out.set(users[0], track)
      continue
    }
    // Timestamps settle it when they are real; otherwise compare lengths.
    const timed = users.filter((w) => trackHasUsableTimes(track, w.startTs, w.endTs))
    if (timed.length === 1) {
      out.set(timed[0], track)
      continue
    }
    const cum = cumulativeDistanceM(track)
    const owner = claimSharedRoute(cum[cum.length - 1], users.map((w) => w.distanceM))
    if (owner !== -1) out.set(users[owner], track)
  }
  return out
}
