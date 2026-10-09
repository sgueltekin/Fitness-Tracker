// Turns one deduplicated workout plus the collected samples into the rows to write.
import { BEST_EFFORT_DISTANCES, defaultCategory } from '@shared/domain'
import type { HealthCollector, NumTable } from './collect'
import { workoutUid } from './dedupe'
import { activeTrack, computeBestEffort, computeLaps, computeSplits, pausedIntervals, round, splitRows, withoutDistanceIn } from './derive'
import { routeStream, type Track } from './gpx'
import {
  chooseDistanceCandidate,
  distanceCandidates,
  distanceFromTrack,
  distanceResolution,
  sampleStream,
  scaleStream,
  type DistanceCandidate,
  type DistanceResolution
} from './streams'
import { localDate } from './time'
import type { BestEffortRow, LapRow, Pt, RawWorkout, SplitRow, WorkoutRecord } from './types'

export interface WorkoutRoute {
  track: Track
  /** The track's timestamps describe the recording (see trackHasUsableTimes). */
  timesUsable: boolean
}

/**
 * Distance records or a GPS track are only used for a workout when their total is within
 * this factor of the workout's distance; the stream is then scaled to that distance.
 */
export const DIST_TOLERANCE = 1.2

/**
 * Samples needed before a workout's average is computed from a stream: at least five and
 * one per two minutes. The watch's background readings every few minutes do not qualify.
 */
function enoughSamples(count: number, durationS: number): boolean {
  return count >= 5 && count >= durationS / 120
}

function distanceTable(c: HealthCollector, w: RawWorkout): NumTable | null {
  switch (w.sport) {
    case 'run':
    case 'walk':
      return c.distWalkRun
    case 'swim':
      return c.distSwim
    case 'cycle':
      return c.distCycle
    default:
      return null // metres walked around the gym are not a workout distance
  }
}

function withinTolerance(totalM: number, workoutDistanceM: number | null): boolean {
  if (workoutDistanceM === null || workoutDistanceM <= 0) return true
  const ratio = totalM / workoutDistanceM
  return ratio <= DIST_TOLERANCE && ratio >= 1 / DIST_TOLERANCE
}

export type DistOrigin = 'own' | 'other' | 'gps' | 'coarse'

/**
 * The `dist` stream and where it came from, in order of preference:
 * 1. detailed distance records of the workout's own source,
 * 2. detailed records of the single other source whose total is closest to the workout's distance,
 * 3. distance along the GPS track, when its timestamps are real,
 * 4. coarse records (pedometer blocks of several minutes) of one source, chosen as in 1 and 2.
 * Sources that only wrote one summary record for the workout are never used: they would
 * turn into a straight line. Metres logged during a manual pause are taken out first, as
 * HealthKit does for the workout's own distance. What remains must agree with that
 * distance within DIST_TOLERANCE, and the stream is scaled so that it ends exactly at it.
 */
export function buildDistStream(c: HealthCollector, w: RawWorkout, route: WorkoutRoute | null): { stream: Pt[]; origin: DistOrigin | null } {
  const table = distanceTable(c, w)
  if (!table) return { stream: [], origin: null }
  const elapsed = w.endTs - w.startTs
  const ownId = c.findSourceId(w.sourceRaw)
  const fit = (stream: Pt[]): Pt[] => (w.distanceM ? scaleStream(stream, w.distanceM) : stream)
  const manualPauses = pausedIntervals(w.events, w.startTs, w.endTs, 'manual')
  const candidates = distanceCandidates(table, w.startTs, w.endTs)
    .map((x) => {
      const stream = withoutDistanceIn(x.stream, manualPauses)
      return { ...x, stream, totalM: stream[stream.length - 1][1] }
    })
    .filter((x) => x.totalM > 0 && withinTolerance(x.totalM, w.distanceM))
  const ofResolution = (r: DistanceResolution): DistanceCandidate | null =>
    chooseDistanceCandidate(
      candidates.filter((x) => distanceResolution(x, elapsed) === r),
      ownId,
      w.distanceM
    )

  const detailed = ofResolution('detailed')
  if (detailed) return { stream: fit(detailed.stream), origin: detailed.sourceId === ownId ? 'own' : 'other' }

  if (route?.timesUsable && w.sport !== 'swim') {
    const gps = withoutDistanceIn(distanceFromTrack(route.track, w.startTs, w.endTs), manualPauses)
    const total = gps.length ? gps[gps.length - 1][1] : 0
    if (total > 0 && withinTolerance(total, w.distanceM)) return { stream: fit(gps), origin: 'gps' }
  }

  const coarse = ofResolution('coarse')
  if (coarse) return { stream: fit(coarse.stream), origin: 'coarse' }
  return { stream: [], origin: null }
}

export function buildWorkoutRecord(w: RawWorkout, c: HealthCollector, route: WorkoutRoute | null): WorkoutRecord {
  const elapsed = w.endTs - w.startTs
  const hr = sampleStream(c.hr, w.startTs, w.endTs)
  const power = w.sport === 'run' ? sampleStream(c.power, w.startTs, w.endTs) : []
  const { stream: dist } = buildDistStream(c, w, route)
  const routePts = route ? routeStream(route.track, w.startTs, route.timesUsable) : []

  let laps: LapRow[] = []
  let splits: SplitRow[] = []
  const bestEfforts: BestEffortRow[] = []
  if (w.sport === 'run') {
    laps = computeLaps(w.events, w.startTs, w.endTs, dist, hr)
    if (dist.length >= 2) {
      const track = activeTrack(dist, pausedIntervals(w.events, w.startTs, w.endTs))
      splits = splitRows(computeSplits(track), hr)
      for (const distanceM of BEST_EFFORT_DISTANCES) {
        const effort = computeBestEffort(track, distanceM)
        if (effort) bestEfforts.push(effort)
      }
    }
  }

  // Fill what the workout itself does not state from the samples recorded during it.
  let { avgHr, minHr, maxHr, avgPowerW, distanceM } = w
  if (avgHr === null && enoughSamples(hr.length, elapsed)) {
    let sum = 0
    let min = Infinity
    let max = -Infinity
    for (const [, v] of hr) {
      sum += v
      if (v < min) min = v
      if (v > max) max = v
    }
    avgHr = round(sum / hr.length, 1)
    minHr = min
    maxHr = max
  }
  if (avgPowerW === null && enoughSamples(power.length, elapsed)) {
    avgPowerW = round(power.reduce((s, [, v]) => s + v, 0) / power.length, 1)
  }
  if (distanceM === null && dist.length >= 2) distanceM = dist[dist.length - 1][1]

  const streams: Record<string, unknown[]> = {}
  if (hr.length) streams.hr = hr
  if (dist.length >= 2) streams.dist = dist
  if (power.length) streams.power = power
  if (routePts.length >= 2) streams.route = routePts

  return {
    uid: workoutUid(w),
    sport: w.sport,
    activityType: w.activityType,
    category: defaultCategory(w.sport, w.title),
    title: w.title,
    source: w.source,
    startTs: w.startTs,
    endTs: w.endTs,
    tzOffsetMin: w.tzOffsetMin,
    localDate: localDate(w.startTs, w.tzOffsetMin),
    durationS: w.durationS,
    distanceM,
    energyKcal: w.energyKcal,
    avgHr,
    minHr,
    maxHr,
    avgPowerW,
    avgStrideM: w.avgStrideM,
    avgGctMs: w.avgGctMs,
    avgVertOscCm: w.avgVertOscCm,
    stepCount: w.stepCount,
    // Only Apple's own figure: the altitude in most route files is too noisy to add up.
    elevationGainM: w.elevationGainM,
    effort: w.effort,
    indoor: w.indoor,
    userEntered: w.userEntered,
    hasRoute: routePts.length >= 2,
    laps,
    splits,
    zones: w.zones,
    bestEfforts,
    streams
  }
}
