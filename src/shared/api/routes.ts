// Data contract for the Routes page.
import type { Ymd } from '../dates'
import type { WorkoutSummary } from './common'

/**
 * How a route runs, told from its track alone:
 *   out-and-back  most of it is run twice, once in each direction
 *   laps          much of it is run more than once in the same direction
 *   loop          it ends near where it started
 *   one-way       everything else
 */
export type RouteShape = 'loop' | 'laps' | 'out-and-back' | 'one-way'

export type Compass = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'

/** [lon, lat] */
export type LonLat = [number, number]

/** One GPS-recorded run in the range. */
export interface RouteRun {
  workout: WorkoutSummary
  /** The track, thinned for an overview map. */
  coords: LonLat[]
  /** `RouteGroup.key` of the route this run followed. */
  group: number
}

/**
 * Runs that followed the same route: their tracks cover each other and are about equally long,
 * whichever way round they were run and wherever on the route they started. A run that matches
 * nothing is a group of one.
 *
 * Membership, `shape`, `heading`, `distanceM` and `outline` come from all recorded runs, so a
 * route keeps its description when the date range changes. `runs`, `bestPaceSPerKm` and
 * `lastDate` count the runs in the range.
 */
export interface RouteGroup {
  /** Id of the oldest run on the route. Stable until the next import. */
  key: number
  /** `RouteArea.key` */
  area: number
  shape: RouteShape
  /** Where the route lies as seen from its start; null when it stays around the start. */
  heading: Compass | null
  /** Typical length: the median distance of the runs on it. */
  distanceM: number
  /** Track of the run that is most like all the others, thinned. */
  outline: LonLat[]
  runs: number
  /** Fastest average pace among the runs in the range. */
  bestPaceSPerKm: number | null
  lastDate: Ymd
}

/** Runs close enough together to share one map view. A run far from home is its own area. */
export interface RouteArea {
  /** 0 is the area with the most recorded runs. */
  key: number
  /** GPS runs in the range. */
  runs: number
  /** Position relative to area 0; null for area 0 itself. */
  offset: { distanceM: number; heading: Compass } | null
}

export interface RoutesData {
  from: Ymd
  to: Ymd
  /** All runs in the range, with or without GPS. */
  runCount: number
  /** Summed workout distance of the GPS runs in the range. */
  mappedDistanceM: number
  /** GPS runs in the range, oldest first. */
  runs: RouteRun[]
  /** Routes with at least one run in the range, most runs first, then most recently run. */
  groups: RouteGroup[]
  /** Areas with at least one run in the range, most runs in the range first. */
  areas: RouteArea[]
}
