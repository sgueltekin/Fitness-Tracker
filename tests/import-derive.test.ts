import { describe, expect, it } from 'vitest'
import {
  activeTrack,
  computeBestEffort,
  computeLaps,
  computeSplits,
  meanInWindow,
  pausedIntervals,
  splitRows,
  valueAt,
  withoutDistanceIn
} from '../src/main/import/derive'
import type { Pt, WorkoutEvent } from '../src/main/import/types'

/** Cumulative distance sampled every `stepS` seconds over pieces of [seconds, metres per second]. */
function distStream(pieces: [number, number][], stepS = 10): Pt[] {
  const out: Pt[] = [[0, 0]]
  let t = 0
  let d = 0
  for (const [seconds, speed] of pieces) {
    for (let s = stepS; s <= seconds; s += stepS) out.push([t + s, d + s * speed])
    t += seconds
    d += seconds * speed
  }
  return out
}

const event = (type: WorkoutEvent['type'], ts: number, durationS: number | null = null): WorkoutEvent => ({ type, ts, durationS })

describe('stream helpers', () => {
  const stream: Pt[] = [
    [0, 0],
    [10, 100],
    [30, 200]
  ]
  it('interpolates and clamps', () => {
    expect(valueAt(stream, 5)).toBe(50)
    expect(valueAt(stream, 20)).toBe(150)
    expect(valueAt(stream, -5)).toBe(0)
    expect(valueAt(stream, 99)).toBe(200)
  })
  it('averages the samples inside a window', () => {
    expect(meanInWindow(stream, 0, 10)).toBe(50)
    expect(meanInWindow(stream, 11, 29)).toBeNull()
    expect(meanInWindow(stream, 10, 30)).toBe(150)
  })
})

describe('paused intervals', () => {
  const events = [
    event('MotionResumed', 1001),
    event('Pause', 1100),
    event('MotionPaused', 1150),
    event('Resume', 1160),
    event('MotionResumed', 1200),
    event('Lap', 1300, 60),
    event('Pause', 1500)
  ]
  it('merges manual and motion pauses and closes an open pause at the end', () => {
    expect(pausedIntervals(events, 1000, 1520)).toEqual([
      [100, 200],
      [500, 520]
    ])
  })
  it('can tell the two kinds apart', () => {
    expect(pausedIntervals(events, 1000, 1520, 'manual')).toEqual([
      [100, 160],
      [500, 520]
    ])
    expect(pausedIntervals(events, 1000, 1520, 'motion')).toEqual([[150, 200]])
  })
  it('is empty without pause events', () => {
    expect(pausedIntervals([event('Lap', 1010, 30), event('Segment', 1010, 30)], 1000, 1520)).toEqual([])
  })
})

describe('splits', () => {
  it('cuts a steady run into kilometres with a partial last one', () => {
    const splits = computeSplits(activeTrack(distStream([[600, 4]])))
    expect(splits.map((s) => s.distanceM)).toEqual([1000, 1000, 400])
    expect(splits.map((s) => s.durationS)).toEqual([250, 250, 100])
    expect(splits[1]).toMatchObject({ startOffsetS: 250, endOffsetS: 500 })
  })

  it('interpolates the kilometre mark between samples', () => {
    // 3 m/s sampled every 7 s: no sample falls on 1000 m
    const splits = computeSplits(activeTrack(distStream([[700, 3]], 7)))
    expect(splits).toHaveLength(3)
    expect(splits[0].durationS).toBeCloseTo(1000 / 3, 6)
    expect(splits[1].durationS).toBeCloseTo(1000 / 3, 6)
    expect(splits[2].distanceM).toBeCloseTo(100, 6)
  })

  it('drops a leftover of a few metres', () => {
    const splits = computeSplits(activeTrack(distStream([[502, 4]], 2))) // 2008 m
    expect(splits.map((s) => s.distanceM)).toEqual([1000, 1000])
  })

  it('does not count a stop at a traffic light when it is marked as a pause', () => {
    const dist = distStream([
      [300, 4],
      [60, 0],
      [300, 4]
    ])
    const unpaused = computeSplits(activeTrack(dist))
    expect(unpaused.map((s) => s.durationS)).toEqual([250, 310, 100])

    const paused = computeSplits(activeTrack(dist, [[300, 360]]))
    expect(paused.map((s) => s.durationS)).toEqual([250, 250, 100])
    // the second kilometre still spans the pause on the workout's clock
    expect(paused[1]).toMatchObject({ startOffsetS: 250, endOffsetS: 560 })
  })

  it('keeps metres logged during a pause without turning them into a sprint', () => {
    const dist: Pt[] = [
      [0, 0],
      [100, 400],
      [160, 430], // 30 m while paused
      [260, 830]
    ]
    const track = activeTrack(dist, [[100, 160]])
    // moving speed is 4 m/s, so the 30 m count as 7.5 s
    expect(track.d[track.d.length - 1]).toBe(830)
    expect(track.t[track.t.length - 1]).toBeCloseTo(207.5, 6)
    for (let i = 1; i < track.t.length; i++) {
      const dt = track.t[i] - track.t[i - 1]
      const dd = track.d[i] - track.d[i - 1]
      if (dd > 0) expect(dd / dt).toBeLessThanOrEqual(4 + 1e-9)
    }
  })

  it('averages heart rate over each split on the workout clock', () => {
    const dist = distStream([[500, 4]])
    const hr: Pt[] = Array.from({ length: 51 }, (_, i) => [i * 10, i * 10 < 250 ? 140 : 160] as Pt)
    const rows = splitRows(computeSplits(activeTrack(dist)), hr)
    expect(rows.map((r) => r.idx)).toEqual([1, 2])
    expect(rows[0].avgHr).toBeCloseTo((25 * 140 + 160) / 26, 1)
    expect(rows[1].avgHr).toBe(160)
    expect(splitRows(computeSplits(activeTrack(dist)), [])[0].avgHr).toBeNull()
  })
})

describe('distance logged during a manual pause', () => {
  it('is removed so that the stream stays flat there', () => {
    const dist: Pt[] = [
      [0, 0],
      [100, 400],
      [160, 430],
      [260, 830]
    ]
    expect(withoutDistanceIn(dist, [[100, 160]])).toEqual([
      [0, 0],
      [100, 400],
      [160, 400],
      [260, 800]
    ])
    expect(withoutDistanceIn(dist, [])).toBe(dist)
  })

  it('splits a segment that straddles the pause boundary', () => {
    const dist: Pt[] = [
      [0, 0],
      [200, 800]
    ]
    // paused from 50 to 150: half of the metres fall inside
    expect(withoutDistanceIn(dist, [[50, 150]])).toEqual([
      [0, 0],
      [50, 200],
      [150, 200],
      [200, 400]
    ])
  })
})

describe('best efforts', () => {
  // 1 km at 2 m/s, 1 km at 4 m/s, 1 km at 2 m/s
  const pieces: [number, number][] = [
    [500, 2],
    [250, 4],
    [500, 2]
  ]

  it('finds the fastest window, not the first one', () => {
    const track = activeTrack(distStream(pieces))
    expect(computeBestEffort(track, 1000)).toEqual({ distanceM: 1000, durationS: 250, startOffsetS: 500 })
    expect(computeBestEffort(track, 2000)?.durationS).toBe(750)
    expect(computeBestEffort(track, 3000)).toEqual({ distanceM: 3000, durationS: 1250, startOffsetS: 0 })
  })

  it('returns null when the run is too short', () => {
    const track = activeTrack(distStream(pieces))
    expect(computeBestEffort(track, 5000)).toBeNull()
    expect(computeBestEffort(activeTrack([]), 1000)).toBeNull()
  })

  it('interpolates inside coarse samples', () => {
    const coarse: Pt[] = [
      [0, 0],
      [100, 300],
      [200, 900],
      [300, 1200]
    ]
    const track = activeTrack(coarse)
    expect(computeBestEffort(track, 600)).toEqual({ distanceM: 600, durationS: 100, startOffsetS: 100 })
    // 600 m at 6 m/s plus 150 m at 3 m/s on either side
    expect(computeBestEffort(track, 750)?.durationS).toBe(150)
    expect(computeBestEffort(track, 1200)).toEqual({ distanceM: 1200, durationS: 300, startOffsetS: 0 })
  })

  it('agrees with a brute-force search on an irregular run', () => {
    // deterministic pseudo-random speeds between 2 and 5 m/s
    let seed = 7
    const next = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648)
    const dist: Pt[] = [[0, 0]]
    for (let i = 0; i < 400; i++) {
      const [t, d] = dist[dist.length - 1]
      const dt = 3 + Math.floor(next() * 9)
      dist.push([t + dt, d + dt * (2 + 3 * next())])
    }
    const track = activeTrack(dist)
    const total = track.d[track.d.length - 1]
    expect(total).toBeGreaterThan(5000)

    const timeAt = (target: number): number => {
      let i = 1
      while (track.d[i] < target) i++
      return track.t[i - 1] + ((target - track.d[i - 1]) / (track.d[i] - track.d[i - 1])) * (track.t[i] - track.t[i - 1])
    }
    for (const distance of [1000, 5000]) {
      let brute = Infinity
      for (let start = 0; start + distance <= total; start += 0.5) brute = Math.min(brute, timeAt(start + distance) - (start === 0 ? 0 : timeAt(start)))
      const best = computeBestEffort(track, distance)!
      expect(best.durationS).toBeLessThanOrEqual(brute + 0.05)
      expect(best.durationS).toBeGreaterThan(brute - 0.5)
      // never faster than the fastest sample-to-sample speed allows
      expect(distance / best.durationS).toBeLessThanOrEqual(5)
    }
  })

  it('leaves a marked pause out of the effort', () => {
    const dist = distStream([
      [200, 4],
      [90, 0],
      [200, 4]
    ])
    expect(computeBestEffort(activeTrack(dist), 1000)?.durationS).toBe(340)
    expect(computeBestEffort(activeTrack(dist, [[200, 290]]), 1000)?.durationS).toBe(250)
  })
})

describe('laps', () => {
  it('reads distance and heart rate off the streams', () => {
    const start = 5000
    const dist = distStream([[600, 3]])
    const hr: Pt[] = Array.from({ length: 61 }, (_, i) => [i * 10, 120 + i] as Pt)
    const laps = computeLaps(
      [event('Lap', start + 300, 300), event('Pause', start + 600), event('Lap', start, 300), event('Segment', start, 600)],
      start,
      start + 600,
      dist,
      hr
    )
    expect(laps).toEqual([
      { idx: 1, startOffsetS: 0, durationS: 300, distanceM: 900, avgHr: 135 },
      { idx: 2, startOffsetS: 300, durationS: 300, distanceM: 900, avgHr: 165 }
    ])
  })

  it('falls back to the next lap or the end for a lap without duration, and to nulls without streams', () => {
    const laps = computeLaps([event('Lap', 100), event('Lap', 160)], 100, 400, [], [])
    expect(laps).toEqual([
      { idx: 1, startOffsetS: 0, durationS: 60, distanceM: null, avgHr: null },
      { idx: 2, startOffsetS: 60, durationS: 240, distanceM: null, avgHr: null }
    ])
  })
})
