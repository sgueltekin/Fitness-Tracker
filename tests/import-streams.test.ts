import { describe, expect, it } from 'vitest'
import { NumTable } from '../src/main/import/collect'
import {
  cumulativeDistanceM,
  haversineM,
  parseGpx,
  routeStream,
  simplifyIndices,
  trackExtentM,
  trackHasUsableTimes,
  type Track
} from '../src/main/import/gpx'
import { assignRoutes, claimSharedRoute } from '../src/main/import/routes'
import {
  chooseDistanceCandidate,
  distanceCandidates,
  distanceFromTrack,
  distanceResolution,
  pickDistanceSource,
  sampleStream,
  scaleStream
} from '../src/main/import/streams'
import type { RawWorkout } from '../src/main/import/types'

const T0 = 1_700_000_000

describe('NumTable', () => {
  it('grows, sorts by the first column and keeps equal keys in order', () => {
    const t = new NumTable(2, 2)
    for (const [k, v] of [
      [5, 1],
      [3, 2],
      [5, 3],
      [1, 4],
      [3, 5]
    ])
      t.push(k, v)
    t.sort()
    expect(Array.from({ length: t.length }, (_, i) => [t.get(i, 0), t.get(i, 1)])).toEqual([
      [1, 4],
      [3, 2],
      [3, 5],
      [5, 1],
      [5, 3]
    ])
    expect(t.lowerBound(3)).toBe(1)
    expect(t.lowerBound(4)).toBe(3)
    expect(t.lowerBound(99)).toBe(5)
  })
})

describe('sample streams', () => {
  it('takes the samples inside the workout from the source with the most of them', () => {
    const hr = new NumTable(3)
    hr.push(T0 - 5, 90, 0)
    for (let i = 0; i <= 10; i++) hr.push(T0 + i * 10, 140 + i, 0)
    hr.push(T0 + 33, 99, 1) // a second device chimes in once
    hr.push(T0 + 105, 80, 0)
    hr.sort()
    const stream = sampleStream(hr, T0, T0 + 100)
    expect(stream).toHaveLength(11)
    expect(stream[0]).toEqual([0, 140])
    expect(stream[10]).toEqual([100, 150])
    expect(sampleStream(hr, T0 + 1000, T0 + 2000)).toEqual([])
  })
})

describe('distance records', () => {
  const WATCH = 0
  const PHONE = 1
  const COPY = 2

  function table(): NumTable {
    const t = new NumTable(4)
    // watch: 4 m/s in 5-second records, with a 60 s gap after 300 s
    for (let s = 0; s < 300; s += 5) t.push(T0 + s, T0 + s + 5, 20, WATCH)
    for (let s = 360; s < 660; s += 5) t.push(T0 + s, T0 + s + 5, 20, WATCH)
    // phone: blocks of 220 s that also cover time before and after the workout
    for (let s = -220; s < 880; s += 220) t.push(T0 + s, T0 + s + 220, 700, PHONE)
    // an app's copy: one record for the whole workout
    t.push(T0, T0 + 660, 2400, COPY)
    t.sort()
    return t
  }

  it('builds one cumulative stream per source, flat where nothing was logged', () => {
    const cands = distanceCandidates(table(), T0, T0 + 660)
    expect(cands.map((c) => c.sourceId)).toEqual([WATCH, PHONE, COPY])
    const watch = cands[0]
    expect(watch.totalM).toBe(2400)
    expect(watch.records).toBe(120)
    expect(watch.stream[0]).toEqual([0, 0])
    expect(watch.stream).toContainEqual([300, 1200])
    expect(watch.stream).toContainEqual([360, 1200])
    expect(watch.stream[watch.stream.length - 1]).toEqual([660, 2400])
    // three full phone blocks; the ones before and after the workout do not count
    expect(cands[1].totalM).toBe(2100)
    expect(cands[1].stream).toEqual([
      [0, 0],
      [220, 700],
      [440, 1400],
      [660, 2100]
    ])
  })

  it('prorates a record that only partly overlaps the workout', () => {
    const t = new NumTable(4)
    t.push(T0 - 100, T0 + 100, 400, PHONE)
    t.push(T0 + 100, T0 + 300, 600, PHONE)
    t.sort()
    const [c] = distanceCandidates(t, T0, T0 + 200)
    expect(c.totalM).toBe(500)
    expect(c.stream).toEqual([
      [0, 0],
      [100, 200],
      [200, 500]
    ])
  })

  it('classifies how finely a source logged', () => {
    const [watch, phone, copy] = distanceCandidates(table(), T0, T0 + 660)
    expect(distanceResolution(watch, 660)).toBe('detailed')
    expect(distanceResolution(phone, 660)).toBe('coarse')
    expect(distanceResolution(copy, 660)).toBe('summary')
  })

  it('picks the own source, else the one closest to the workout distance', () => {
    const totals = new Map([
      [WATCH, 2400],
      [PHONE, 2100]
    ])
    expect(pickDistanceSource(totals, PHONE, 2400)).toBe(PHONE)
    expect(pickDistanceSource(totals, 7, 2380)).toBe(WATCH)
    expect(pickDistanceSource(totals, 7, 2150)).toBe(PHONE)
    expect(pickDistanceSource(totals, -1, null)).toBe(WATCH) // no distance known: the larger total
    expect(pickDistanceSource(new Map(), 0, 2400)).toBeNull()
    const cands = distanceCandidates(table(), T0, T0 + 660)
    expect(chooseDistanceCandidate(cands, 7, 2150)?.sourceId).toBe(PHONE)
    expect(chooseDistanceCandidate([], 7, 2150)).toBeNull()
  })

  it('scales a stream to the workout distance', () => {
    expect(
      scaleStream(
        [
          [0, 0],
          [10, 50],
          [20, 100]
        ],
        110
      )
    ).toEqual([
      [0, 0],
      [10, 55],
      [20, 110]
    ])
  })
})

/** A track heading east from an arbitrary point, one point per `stepS` seconds at `speed` m/s. */
function eastward(points: number, stepS: number, speed: number, startTs: number | null): Track {
  const lat = 10
  const metresPerDegree = haversineM(20, lat, 21, lat)
  const track: Track = { lon: [], lat: [], ele: [], time: [] }
  for (let i = 0; i < points; i++) {
    track.lon.push(20 + (i * stepS * speed) / metresPerDegree)
    track.lat.push(lat)
    track.ele.push(100 + i)
    track.time.push(startTs === null ? T0 + 86_400 : startTs + i * stepS)
  }
  return track
}

describe('GPX routes', () => {
  it('parses track points with elevation and time', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>2024-03-02T10:00:00Z</time></metadata>
  <trk><name>Route</name><trkseg>
    <trkpt lon="20.000000" lat="10.000000"><ele>100.5</ele><time>2024-03-02T09:00:00Z</time><extensions><speed>2.5</speed></extensions></trkpt>
    <trkpt lon="20.000100" lat="10.000000"><ele>101</ele><time>2024-03-02T09:00:01Z</time></trkpt>
    <trkpt lon="20.000200" lat="10.000050"></trkpt>
    <trkpt lon="oops" lat="10"><ele>1</ele></trkpt>
  </trkseg></trk>
</gpx>`
    const track = parseGpx(gpx)
    expect(track.lon).toEqual([20, 20.0001, 20.0002])
    expect(track.lat).toEqual([10, 10, 10.00005])
    expect(track.ele[0]).toBe(100.5)
    expect(track.ele[2]).toBeNaN()
    expect(track.time[1] - track.time[0]).toBe(1)
    expect(track.time[2]).toBeNaN()
    expect(parseGpx('not xml at all').lon).toEqual([])
  })

  it('measures distance along the track', () => {
    const track = eastward(101, 10, 3, T0)
    const cum = cumulativeDistanceM(track)
    expect(cum[0]).toBe(0)
    expect(cum[100]).toBeCloseTo(3000, 1)
    expect(trackExtentM(track)).toBeCloseTo(3000, 1)
  })

  it('keeps the shape when downsampling', () => {
    // a straight line with one spike and one corner
    const x = Array.from({ length: 1001 }, (_, i) => i)
    const y = x.map((v) => (v === 400 ? 50 : v > 800 ? v - 800 : 0))
    const kept = simplifyIndices(x, y, 10)
    expect(kept.length).toBeLessThanOrEqual(10)
    expect(kept[0]).toBe(0)
    expect(kept[kept.length - 1]).toBe(1000)
    for (const i of [399, 400, 401, 800]) expect(kept).toContain(i)
    expect(simplifyIndices(x, y, 5000)).toHaveLength(1001)
  })

  it('writes [lon, lat, elevation, t] and caps the number of points', () => {
    const wiggle = eastward(4000, 1, 3, T0 + 2)
    for (let i = 0; i < wiggle.lat.length; i++) wiggle.lat[i] += Math.sin(i / 40) * 0.0005
    const pts = routeStream(wiggle, T0, true, 1500)
    expect(pts.length).toBe(1500)
    expect(pts[0]).toEqual([20, 10, 100, 2])
    expect(pts[pts.length - 1][3]).toBe(4001)
    const short = routeStream(eastward(5, 1, 3, T0), T0, true)
    expect(short).toHaveLength(5)
  })

  it('recognises timestamps that do not describe the recording', () => {
    const real = eastward(100, 5, 3, T0 + 1)
    expect(trackHasUsableTimes(real, T0, T0 + 500)).toBe(true)
    expect(trackHasUsableTimes(real, T0 + 86_400, T0 + 86_900)).toBe(false) // another day's workout
    const stamped = eastward(100, 5, 3, null) // every point carries the time the file was saved
    expect(trackHasUsableTimes(stamped, T0, T0 + 500)).toBe(false)
    expect(routeStream(stamped, T0, false)[3][3]).toBeNull()
  })

  it('turns a timed track into a distance stream', () => {
    const dist = distanceFromTrack(eastward(601, 1, 3, T0 + 5), T0, T0 + 700)
    expect(dist[0]).toEqual([0, 0])
    expect(dist[1]).toEqual([5, 0])
    const [t, d] = dist[dist.length - 1]
    expect(t).toBe(605)
    expect(d).toBeCloseTo(1800, 0)
  })
})

describe('route files shared by several workouts', () => {
  it('belong to the one workout whose distance matches the track', () => {
    expect(claimSharedRoute(5900, [5100, 5000, 3400, 6000])).toBe(3)
    expect(claimSharedRoute(5050, [5100, 5000, 3400, 6000])).toBe(-1) // two candidates
    expect(claimSharedRoute(8000, [5100, 5000, null])).toBe(-1)
  })

  const workout = (startTs: number, distanceM: number, routePath: string | null, indoor = false): RawWorkout =>
    ({ startTs, endTs: startTs + 1000, distanceM, routePath, indoor }) as RawWorkout

  it('assigns each track at most once and skips indoor workouts and tracks that go nowhere', () => {
    const shared = eastward(301, 10, 2, null) // 6000 m, useless times
    const own = eastward(301, 10, 1, T0 + 1) // 3000 m, real times
    const still: Track = { lon: [20, 20, 20], lat: [10, 10, 10], ele: [1, 1, 1], time: [T0, T0 + 1, T0 + 2] }
    const a = workout(T0 - 50_000, 5100, '/workout-routes/shared.gpx')
    const b = workout(T0 - 40_000, 6050, '/workout-routes/shared.gpx')
    const c = workout(T0, 3000, '/workout-routes/own.gpx')
    const d = workout(T0 + 10_000, 4000, '/workout-routes/still.gpx')
    const e = workout(T0 + 20_000, 3000, '/workout-routes/own.gpx', true)
    const f = workout(T0 + 30_000, 3000, '/workout-routes/missing.gpx')
    const g = workout(T0 + 40_000, 3000, null)
    const assigned = assignRoutes(
      [a, b, c, d, e, f, g],
      new Map([
        ['/workout-routes/shared.gpx', shared],
        ['/workout-routes/own.gpx', own],
        ['/workout-routes/still.gpx', still]
      ])
    )
    expect([...assigned.keys()]).toEqual([b, c])
    expect(assigned.get(b)).toBe(shared)
    expect(assigned.get(c)).toBe(own)
  })
})
