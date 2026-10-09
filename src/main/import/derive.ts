// Pure per-workout derivations on time series: paused time, splits, best efforts, laps.
// A stream is a list of [seconds from workout start, value] points sorted by time.
import type { BestEffortRow, LapRow, Pt, SplitRow, WorkoutEvent } from './types'

/** Value of a stream at time t, linearly interpolated and clamped to the ends. */
export function valueAt(stream: Pt[], t: number): number {
  const n = stream.length
  if (n === 0) return NaN
  if (t <= stream[0][0]) return stream[0][1]
  if (t >= stream[n - 1][0]) return stream[n - 1][1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (stream[mid][0] <= t) lo = mid
    else hi = mid
  }
  const [t0, v0] = stream[lo]
  const [t1, v1] = stream[hi]
  return t1 === t0 ? v1 : v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)
}

/** Mean of the samples with t0 <= t <= t1; null when there are none. */
export function meanInWindow(stream: Pt[], t0: number, t1: number): number | null {
  let lo = 0
  let hi = stream.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (stream[mid][0] < t0) lo = mid + 1
    else hi = mid
  }
  let sum = 0
  let n = 0
  for (let i = lo; i < stream.length && stream[i][0] <= t1; i++) {
    sum += stream[i][1]
    n++
  }
  return n ? sum / n : null
}

/**
 * Paused intervals of a workout as [from, to] offsets in seconds, merged and sorted.
 * 'manual' are the pauses HealthKit itself takes out of the workout (Pause .. Resume, by
 * the user or an app's auto-pause): neither their time nor their distance is part of the
 * workout's totals. 'motion' are the stretches the watch saw no movement
 * (MotionPaused .. MotionResumed) while the workout clock kept running. A pause that is
 * never resumed lasts until the end of the workout.
 */
export function pausedIntervals(events: WorkoutEvent[], startTs: number, endTs: number, kind: 'all' | 'manual' | 'motion' = 'all'): Pt[] {
  const total = endTs - startTs
  const raw: Pt[] = []
  let manual: number | null = null
  let motion: number | null = null
  const sorted = [...events].sort((a, b) => a.ts - b.ts)
  for (const e of sorted) {
    const t = Math.min(Math.max(e.ts - startTs, 0), total)
    switch (e.type) {
      case 'Pause':
        if (kind !== 'motion') manual ??= t
        break
      case 'Resume':
        if (manual !== null) raw.push([manual, t])
        manual = null
        break
      case 'MotionPaused':
        if (kind !== 'manual') motion ??= t
        break
      case 'MotionResumed':
        if (motion !== null) raw.push([motion, t])
        motion = null
        break
      default:
        break
    }
  }
  if (manual !== null) raw.push([manual, total])
  if (motion !== null) raw.push([motion, total])

  raw.sort((a, b) => a[0] - b[0])
  const merged: Pt[] = []
  for (const [from, to] of raw) {
    if (to <= from) continue
    const last = merged[merged.length - 1]
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  return merged
}

/**
 * Adds a point at every interval boundary inside the stream, so that each segment lies
 * entirely inside or outside the intervals. `inside[i]` is true when the segment ending
 * at point i lies inside one. Intervals must be sorted and disjoint.
 */
function splitAtIntervals(stream: Pt[], intervals: Pt[]): { points: Pt[]; inside: boolean[] } {
  const points: Pt[] = []
  if (stream.length === 0) return { points, inside: [] }
  const first = stream[0][0]
  const last = stream[stream.length - 1][0]
  const cuts: number[] = []
  for (const [from, to] of intervals) {
    if (from > first && from < last) cuts.push(from)
    if (to > first && to < last) cuts.push(to)
  }
  let c = 0
  for (const [t, v] of stream) {
    while (c < cuts.length && cuts[c] < t) {
      const at = cuts[c++]
      if (points.length && at > points[points.length - 1][0]) points.push([at, valueAt(stream, at)])
    }
    if (c < cuts.length && cuts[c] === t) c++
    // A cumulative distance never decreases; guard against noisy input.
    points.push([t, points.length ? Math.max(v, points[points.length - 1][1]) : v])
  }
  const inside = new Array<boolean>(points.length).fill(false)
  let p = 0
  for (let i = 1; i < points.length; i++) {
    const mid = (points[i - 1][0] + points[i][0]) / 2
    while (p < intervals.length && intervals[p][1] <= mid) p++
    inside[i] = p < intervals.length && intervals[p][0] <= mid && mid < intervals[p][1]
  }
  return { points, inside }
}

/**
 * A cumulative distance stream without the metres logged inside the given intervals: it
 * stays flat there. Used for manual pauses, whose distance HealthKit does not count either
 * (a watch keeps logging steps while the workout is paused).
 */
export function withoutDistanceIn(stream: Pt[], intervals: Pt[]): Pt[] {
  if (intervals.length === 0 || stream.length === 0) return stream
  const { points, inside } = splitAtIntervals(stream, intervals)
  const out: Pt[] = [[points[0][0], points[0][1]]]
  let removed = 0
  for (let i = 1; i < points.length; i++) {
    if (inside[i]) removed += points[i][1] - points[i - 1][1]
    out.push([points[i][0], points[i][1] - removed])
  }
  return out
}

/**
 * A distance stream on the moving clock: `t` is the time spent moving and `d` the distance
 * covered up to then; `real` is the matching offset on the workout's own clock.
 */
export interface ActiveTrack {
  t: number[]
  d: number[]
  real: number[]
}

/**
 * Takes the paused intervals out of a cumulative distance stream.
 *
 * Time inside a pause does not count. Distance logged inside a pause (the first steps
 * before the watch notices the restart, a few metres of GPS drift) is kept, so that the
 * track still ends at the stream's total, and is given the time it would take at the
 * workout's average moving speed, capped at the time that really passed. A pause can
 * therefore shorten the clock but never produce a burst of speed.
 * Without pauses the result is the stream itself.
 */
export function activeTrack(dist: Pt[], paused: Pt[] = []): ActiveTrack {
  const out: ActiveTrack = { t: [], d: [], real: [] }
  if (dist.length === 0) return out
  const { points, inside } = splitAtIntervals(dist, paused)

  let movingS = 0
  let movingM = 0
  for (let i = 1; i < points.length; i++) {
    if (inside[i]) continue
    movingS += points[i][0] - points[i - 1][0]
    movingM += points[i][1] - points[i - 1][1]
  }
  const movingSpeed = movingS > 0 && movingM > 0 ? movingM / movingS : 0

  let activeT = 0
  let activeD = 0
  out.t.push(0)
  out.d.push(0)
  out.real.push(points[0][0])
  for (let i = 1; i < points.length; i++) {
    const dt = points[i][0] - points[i - 1][0]
    const dd = points[i][1] - points[i - 1][1]
    // Without any moving stretch to take a speed from, the pauses cannot be trusted either.
    activeT += inside[i] && movingSpeed > 0 ? Math.min(dt, dd / movingSpeed) : dt
    activeD += dd
    out.t.push(activeT)
    out.d.push(activeD)
    out.real.push(points[i][0])
  }
  return out
}

/** Moving time and clock offset at which the track first reaches distance `target`. */
function locate(track: ActiveTrack, target: number): { t: number; real: number } {
  const { t, d, real } = track
  const n = d.length
  if (target <= d[0]) return { t: t[0], real: real[0] }
  // first index with d >= target
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (d[mid] < target) lo = mid + 1
    else hi = mid
  }
  const j = lo
  const i = j - 1
  const f = d[j] > d[i] ? (target - d[i]) / (d[j] - d[i]) : 1
  return { t: t[i] + f * (t[j] - t[i]), real: real[i] + f * (real[j] - real[i]) }
}

export interface Split {
  distanceM: number
  /** Moving time. */
  durationS: number
  /** Clock offsets of the split's start and end, for averaging other streams over it. */
  startOffsetS: number
  endOffsetS: number
}

/**
 * Splits of `splitM` metres. A final partial split is kept when it is at least
 * `minPartialM` long; shorter leftovers (the last metres of a run that is nominally 5 km) would only show a noisy pace.
 */
export function computeSplits(track: ActiveTrack, splitM = 1000, minPartialM = 20): Split[] {
  const n = track.d.length
  if (n < 2) return []
  const total = track.d[n - 1]
  const splits: Split[] = []
  let prev = { t: track.t[0], real: track.real[0] }
  const full = Math.floor((total + 1e-6) / splitM)
  for (let k = 1; k <= full; k++) {
    const at = locate(track, Math.min(k * splitM, total))
    splits.push({ distanceM: splitM, durationS: at.t - prev.t, startOffsetS: prev.real, endOffsetS: at.real })
    prev = at
  }
  const rest = total - full * splitM
  if (rest >= minPartialM) {
    const at = locate(track, total)
    splits.push({ distanceM: rest, durationS: at.t - prev.t, startOffsetS: prev.real, endOffsetS: at.real })
  }
  return splits
}

export function splitRows(splits: Split[], hr: Pt[]): SplitRow[] {
  return splits.map((s, i) => ({
    idx: i + 1,
    distanceM: round(s.distanceM, 1),
    durationS: round(s.durationS, 1),
    avgHr: roundOrNull(hr.length ? meanInWindow(hr, s.startOffsetS, s.endOffsetS) : null, 1)
  }))
}

/**
 * Fastest continuous stretch of `distanceM` metres, in moving time. The stream is treated
 * as piecewise linear, so the best window starts or ends on a sample; both cases are
 * scanned with two pointers. Null when the track is shorter than the distance.
 */
export function computeBestEffort(track: ActiveTrack, distanceM: number): BestEffortRow | null {
  const { t, d, real } = track
  const n = d.length
  if (n < 2 || d[n - 1] - d[0] < distanceM) return null
  let best = Infinity
  let bestStart = 0

  // Windows that start on a sample.
  let j = 0
  for (let i = 0; i < n; i++) {
    const target = d[i] + distanceM
    if (target > d[n - 1]) break
    // Across a cut-out pause two points share time and distance; start from the later one.
    if (i + 1 < n && t[i + 1] === t[i] && d[i + 1] === d[i]) continue
    while (j < n - 1 && d[j] < target) j++
    // d[j-1] < target <= d[j]
    const end = j === 0 || d[j] === d[j - 1] ? t[j] : t[j - 1] + ((target - d[j - 1]) / (d[j] - d[j - 1])) * (t[j] - t[j - 1])
    const duration = end - t[i]
    if (duration < best) {
      best = duration
      bestStart = real[i]
    }
  }

  // Windows that end on a sample.
  let i = 0
  for (let k = 0; k < n; k++) {
    const target = d[k] - distanceM
    if (target < d[0]) continue
    while (i < n - 1 && d[i + 1] <= target) i++
    // d[i] <= target < d[i+1], so the window starts inside segment i
    const f = i < n - 1 && d[i + 1] > d[i] ? (target - d[i]) / (d[i + 1] - d[i]) : 0
    const start = t[i] + f * ((t[i + 1] ?? t[i]) - t[i])
    const duration = t[k] - start
    if (duration < best) {
      best = duration
      bestStart = real[i] + f * ((real[i + 1] ?? real[i]) - real[i])
    }
  }

  if (!Number.isFinite(best) || best <= 0) return null
  return { distanceM, durationS: round(best, 1), startOffsetS: round(bestStart, 1) }
}

/** Laps from the source app's Lap events, with distance and heart rate read off the streams. */
export function computeLaps(events: WorkoutEvent[], startTs: number, endTs: number, dist: Pt[], hr: Pt[]): LapRow[] {
  const laps = events.filter((e) => e.type === 'Lap').sort((a, b) => a.ts - b.ts)
  return laps.map((lap, i) => {
    const from = lap.ts - startTs
    const next = i + 1 < laps.length ? laps[i + 1].ts : endTs
    const duration = lap.durationS ?? Math.max(0, next - lap.ts)
    const to = from + duration
    return {
      idx: i + 1,
      startOffsetS: round(from, 1),
      durationS: round(duration, 1),
      distanceM: dist.length ? round(Math.max(0, valueAt(dist, to) - valueAt(dist, from)), 1) : null,
      avgHr: roundOrNull(hr.length ? meanInWindow(hr, from, to) : null, 1)
    }
  })
}

export function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export function roundOrNull(v: number | null, digits: number): number | null {
  return v === null || !Number.isFinite(v) ? null : round(v, digits)
}
