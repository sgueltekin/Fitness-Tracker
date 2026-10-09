// Route grouping on made-up tracks: everything is laid out in metres around an arbitrary point.
import { describe, expect, it } from 'vitest'
import {
  clusterComplete,
  compass,
  describeTrack,
  fingerprint,
  groupTracks,
  offsetBetween,
  similarity,
  thinTrack,
  type TrackInput
} from '../src/main/queries/routes-grouping'

const LON0 = 20
const LAT0 = 10
const M_PER_DEG = 111_320
const KX = M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)

type XY = [number, number]

/** [x east, y north] in metres -> [lon, lat, elevation, t] as stored in a route stream. */
function track(id: number, xy: XY[]): TrackInput {
  return { id, coords: xy.map(([x, y], i) => [LON0 + x / KX, LAT0 + y / M_PER_DEG, 100, i]) }
}

/** Puts a point every `step` metres along a path, the way a watch records one. */
function densify(xy: XY[], step = 10): XY[] {
  const out: XY[] = [xy[0]]
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]
    const [bx, by] = xy[i]
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  return out
}

/**
 * GPS error: every point is off by up to `metres` in each axis, repeatably. The error wanders
 * slowly along the track, as it does in a real recording, rather than jumping between points.
 */
function scatter(xy: XY[], metres: number, seed: number): XY[] {
  return xy.map(([x, y], i) => [x + Math.sin(i * 0.05 + seed) * metres, y + Math.cos(i * 0.08 + seed * 2) * metres])
}

const shift = (xy: XY[], dx: number, dy: number): XY[] => xy.map(([x, y]) => [x + dx, y + dy])
const reversed = (xy: XY[]): XY[] => [...xy].reverse()

/** A closed loop started `offset` metres further along. */
function startedAt(loopXy: XY[], offset: number): XY[] {
  const pts = densify(loopXy, 10).slice(0, -1)
  const k = Math.round(offset / 10) % pts.length
  const turned = [...pts.slice(k), ...pts.slice(0, k)]
  return [...turned, turned[0]]
}

// A 3 km block loop (1000 m x 500 m), starting at its south-west corner.
const BLOCK: XY[] = [[0, 0], [1000, 0], [1000, 500], [0, 500], [0, 0]]
/** Straight east for `turn` metres and back. */
const outAndBack = (turn: number): XY[] => [[0, 0], [turn, 0], [0, 0]]

const sizes = (g: { ids: number[] }[]): number[] => g.map((x) => x.ids.length)
const groupWith = (g: { ids: number[] }[], id: number): number[] => g.find((x) => x.ids.includes(id))?.ids ?? []

describe('same route', () => {
  it('is the same loop in the other direction or started further along', () => {
    const { groups } = groupTracks([
      track(1, densify(BLOCK)),
      track(2, reversed(densify(BLOCK))),
      track(3, startedAt(BLOCK, 100)),
      track(4, reversed(startedAt(BLOCK, 1300)))
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].ids).toEqual([1, 2, 3, 4])
    expect(groups[0].shape).toBe('loop')
  })

  it('survives GPS scatter and sparse points', () => {
    const { groups } = groupTracks([
      track(1, scatter(densify(BLOCK, 5), 10, 1)),
      track(2, scatter(densify(BLOCK, 12), 10, 2)),
      track(3, BLOCK) // corners only, as after heavy downsampling
    ])
    expect(sizes(groups)).toEqual([3])
  })

  it('is not a longer run that shares the first kilometres', () => {
    const six: XY[] = [[0, 0], [3000, 0], [3000, 3000]]
    const ten: XY[] = [[0, 0], [3000, 0], [3000, -7000]]
    const { groups } = groupTracks([track(1, densify(six)), track(2, densify(ten))])
    expect(sizes(groups)).toEqual([1, 1])
  })

  it('is not the same streets run a different number of times', () => {
    const twice = [...densify(BLOCK), ...densify(BLOCK).slice(1)]
    const { groups } = groupTracks([track(1, densify(BLOCK)), track(2, twice), track(3, densify(outAndBack(1500))), track(4, densify([[0, 0], [1500, 0]]))])
    expect(sizes(groups)).toEqual([1, 1, 1, 1])
  })

  it('is not the next street over', () => {
    const { groups } = groupTracks([track(1, densify(BLOCK)), track(2, shift(densify(BLOCK), 150, 150))])
    expect(sizes(groups)).toEqual([1, 1])
  })

  it('tolerates a short detour but not a different half', () => {
    // 200 m of the 3 km loop replaced by a dog-leg one block out: still the same route.
    const detour: XY[] = [[0, 0], [400, 0], [400, -100], [600, -100], [600, 0], [1000, 0], [1000, 500], [0, 500], [0, 0]]
    // The whole northern half replaced by a southern one.
    const mirrored: XY[] = [[0, 0], [1000, 0], [1000, -500], [0, -500], [0, 0]]
    const { groups } = groupTracks([track(1, densify(BLOCK)), track(2, densify(detour)), track(3, densify(mirrored))])
    expect(groupWith(groups, 1)).toEqual([1, 2])
    expect(groupWith(groups, 3)).toEqual([3])
  })

  it('does not chain runs that each go a little further into one group', () => {
    // 5.0, 5.6, 6.2 and 6.8 km: neighbours match, the shortest and the longest do not.
    const { groups } = groupTracks([2500, 2800, 3100, 3400].map((turn, i) => track(i + 1, densify(outAndBack(turn)))))
    expect(groupWith(groups, 1)).not.toContain(4)
    expect(sizes(groups)).toEqual([2, 2])
    // The closest pair is merged first, so the split is the same whatever order the runs come in.
    const shuffled = groupTracks([3100, 2500, 3400, 2800].map((turn, i) => track(i + 1, densify(outAndBack(turn)))))
    expect(groupWith(shuffled.groups, 1)).toEqual([1, 3]) // 6.2 km with 6.8 km
    expect(groupWith(shuffled.groups, 2)).toEqual([2, 4]) // 5.0 km with 5.6 km
  })

  it('puts every track in exactly one group and skips tracks without a line', () => {
    const { groups, areas } = groupTracks([
      track(1, densify(BLOCK)),
      track(2, [[0, 0]]),
      track(3, []),
      track(4, densify(outAndBack(900))),
      track(5, reversed(densify(BLOCK)))
    ])
    expect(groups.map((g) => g.ids)).toEqual([[1, 5], [4]])
    expect(areas.map((a) => a.ids)).toEqual([[1, 4, 5]])
  })

  it('picks the run most like the others to stand for the group', () => {
    const { groups } = groupTracks([2500, 2700, 2600].map((turn, i) => track(i + 1, densify(outAndBack(turn)))))
    expect(groups).toHaveLength(1)
    expect(groups[0].representativeId).toBe(3) // the 2600 m one sits between the other two
    expect(groups[0].lengthM).toBeCloseTo(5200, -2)
  })
})

describe('similarity', () => {
  const origin: [number, number] = [LON0, LAT0]
  const print = (xy: XY[]) => fingerprint(track(0, densify(xy)).coords, origin)

  it('is symmetric, 1 for the same track and scaled by the length ratio', () => {
    const a = print(outAndBack(2000))
    const b = print(outAndBack(1800))
    expect(similarity(a, a)).toBeCloseTo(1, 5)
    expect(similarity(a, b)).toBe(similarity(b, a))
    // all of b lies on a, 90% of a lies on b, and b is 90% as long: 0.9 * 0.9
    expect(similarity(a, b)).toBeCloseTo(0.81, 1)
    expect(a.lengthM).toBeCloseTo(4000, -2)
  })

  it('is 0 below the overlap or length threshold', () => {
    const a = print(outAndBack(2000))
    expect(similarity(a, print(outAndBack(1500)))).toBe(0) // 75% as long
    expect(similarity(a, print([[0, 0], [1000, 0], [1000, 1000], [1000, 0], [0, 0]]))).toBe(0) // same length, half elsewhere
    expect(similarity(a, print([[0, 0], [2000, 0]]))).toBe(0) // one way only
  })
})

describe('clusterComplete', () => {
  it('merges only while every pair in the cluster is above the threshold', () => {
    // 0-1 and 1-2 match, 0-2 does not; 3 matches nothing.
    const n = 4
    const sim = new Float64Array(n * n)
    const set = (i: number, j: number, s: number): void => {
      sim[i * n + j] = s
      sim[j * n + i] = s
    }
    set(0, 1, 0.9)
    set(1, 2, 0.95)
    expect(clusterComplete(sim, n, 0.8)).toEqual([[0], [1, 2], [3]])
    set(0, 2, 0.85)
    expect(clusterComplete(sim, n, 0.8)).toEqual([[0, 1, 2], [3]])
  })
})

describe('areas', () => {
  it('separate runs that are far apart and never share a group', () => {
    const away = shift(densify(BLOCK), 20_000, 20_000)
    const { groups, areas } = groupTracks([
      track(1, away),
      track(2, densify(BLOCK)),
      track(3, reversed(densify(BLOCK))),
      // 3 km from the others: close enough to share a map
      track(4, shift(densify(outAndBack(800)), 4000, 0))
    ])
    expect(areas.map((a) => a.ids)).toEqual([[2, 3, 4], [1]])
    expect(groups.map((g) => [g.ids, g.area])).toEqual([[[2, 3], 0], [[4], 0], [[1], 1]])
    const off = offsetBetween(areas[0].center, areas[1].center)
    expect(off.heading).toBe('NE')
    expect(off.distanceM / 1000).toBeGreaterThan(24)
    expect(off.distanceM / 1000).toBeLessThan(28)
  })
})

describe('describing a track', () => {
  const describe_ = (xy: XY[]) => describeTrack(track(0, densify(xy)).coords)

  it('tells loops, laps, out-and-backs and one-way runs apart', () => {
    expect(describe_(BLOCK).shape).toBe('loop')
    expect(describe_([...BLOCK, ...BLOCK.slice(1), ...BLOCK.slice(1)]).shape).toBe('laps')
    expect(describe_(outAndBack(2000)).shape).toBe('out-and-back')
    expect(describe_([[0, 0], [1500, 0], [1500, 1500]]).shape).toBe('one-way')
    // out along one street, back along the next one 40 m over: still an out-and-back
    expect(describe_([[0, 0], [2000, 0], [2000, 40], [0, 40], [0, 0]]).shape).toBe('out-and-back')
    // a loop on a stick is a loop as long as the stick is the smaller part
    expect(describe_([[0, 0], [300, 0], [300, 500], [1300, 500], [1300, -500], [300, -500], [300, 0], [0, 0]]).shape).toBe('loop')
    // stopping the watch 300 m short of the start keeps a 3 km loop a loop
    expect(describe_([[0, 0], [1000, 0], [1000, 500], [0, 500], [0, 300]]).shape).toBe('loop')
  })

  it('gives the direction the route lies in from its start', () => {
    expect(describe_(BLOCK).heading).toBe('NE')
    expect(describe_(outAndBack(2000)).heading).toBe('E')
    expect(describe_([[0, 0], [0, -1500], [0, 0]]).heading).toBe('S')
    expect(describe_([[0, 0], [-800, 800], [-1600, 0], [-800, -800], [0, 0]]).heading).toBe('W')
    // a loop with the start in the middle of it lies in no direction
    expect(describe_([[0, 0], [500, 0], [500, 500], [-500, 500], [-500, -500], [500, -500], [500, 0], [0, 0]]).heading).toBeNull()
    expect(describe_(BLOCK).lengthM).toBeCloseTo(3000, -2)
  })

  it('names compass points', () => {
    expect([0, 44, 90, 135, 180, 225, 270, 315, 350, -90].map(compass)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'W'])
  })
})

describe('thinning a track for the map', () => {
  it('keeps corners, drops points on straight stretches and rounds coordinates', () => {
    const coords = track(0, scatter(densify(BLOCK, 5), 1, 3)).coords
    expect(coords.length).toBeGreaterThan(500)
    const thin = thinTrack(coords, 3)
    expect(thin.length).toBeLessThan(20)
    expect(thin[0]).toEqual([Math.round((coords[0][0] as number) * 1e5) / 1e5, Math.round((coords[0][1] as number) * 1e5) / 1e5])
    // every corner of the block is still there, give or take a recorded point
    for (const [x, y] of BLOCK) {
      const near = thin.some(([lon, lat]) => Math.hypot((lon - LON0) * KX - x, (lat - LAT0) * M_PER_DEG - y) < 12)
      expect(near).toBe(true)
    }
    expect(thinTrack([], 3)).toEqual([])
    expect(thinTrack([[LON0, LAT0, null, null]], 3)).toEqual([[LON0, LAT0]])
  })
})
