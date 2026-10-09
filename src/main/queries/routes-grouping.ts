// Decides which GPS tracks are "the same route" and describes a route without naming places.
// Pure geometry: no database, no Electron. Coordinates are [lon, lat, ...] as in the route stream.
//
// How two tracks are compared
//   Both are walked in equal steps and every step is dropped into a square grid cell. A step of
//   track A is "on" track B when B passes through that cell or one of its eight neighbours, which
//   forgives GPS scatter and the other side of the street. The similarity of two tracks is the
//   smaller of "share of A that is on B" and "share of B that is on A", and it is zero when their
//   lengths differ too much. That makes it blind to direction and to where on a loop the watch
//   was started, while a short run that only shares the first kilometres of a long one scores
//   low (most of the long run is not on the short one), and two laps of a loop do not match one.
//
// How tracks become groups
//   Complete-linkage clustering: the closest tracks are merged first, and only while every pair
//   inside the merged group still matches. Chaining (5 km ~ 5.5 km ~ 6 km ~ ... ending up as one
//   route) cannot happen, because the two ends of such a chain do not match each other.

import type { Compass, RouteShape } from '@shared/api/routes'

/** Grid cell edge in metres. A point matches anything within one cell, so 25-50 m. */
export const CELL_M = 25
/** Distance between the steps a track is walked in. Half a cell, so no crossed cell is skipped. */
export const STEP_M = CELL_M / 2
/** Tracks match when each has at least this share of its length on the other. */
export const MIN_OVERLAP = 0.8
/** Tracks match only when the shorter is at least this share of the longer. */
export const MIN_LENGTH_RATIO = 0.8
/** Tracks whose bounding boxes come closer than twice this belong to one area. */
export const AREA_MARGIN_M = 2000

const M_PER_DEG = 111_320
const RAD = Math.PI / 180
const KEY_SPAN = 2 ** 21
const KEY_OFFSET = 2 ** 20

const COMPASS: Compass[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export interface TrackInput {
  id: number
  /** [lon, lat, ...]; further elements are ignored. */
  coords: readonly (readonly (number | null)[])[]
}

export interface TrackGroup {
  /** Member ids in input order. */
  ids: number[]
  /** The member most similar to all the others; its track stands for the group. */
  representativeId: number
  shape: RouteShape
  /** Where the route lies as seen from its start; null when it stays around the start. */
  heading: Compass | null
  /** Length of the representative track in metres. */
  lengthM: number
  /** Index into `areas`. */
  area: number
}

export interface TrackArea {
  /** Member ids in input order. */
  ids: number[]
  /** Centre of the area's bounding box, [lon, lat]. */
  center: [number, number]
}

export interface Grouping {
  /** Largest first; ties in input order. */
  groups: TrackGroup[]
  /** Largest first; ties in input order. */
  areas: TrackArea[]
}

/** Flat-earth projection to metres around a reference point; good for anything city-sized. */
interface Frame {
  lon0: number
  lat0: number
  kx: number
  ky: number
}

function frameAt(lon0: number, lat0: number): Frame {
  return { lon0, lat0, kx: Math.cos(lat0 * RAD) * M_PER_DEG, ky: M_PER_DEG }
}

function lonLat(coords: TrackInput['coords']): [number, number][] {
  const out: [number, number][] = []
  for (const c of coords) {
    const lon = c[0]
    const lat = c[1]
    if (typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat])
  }
  return out
}

/** The track walked in steps of STEP_M: x and y in metres, interleaved. */
function resample(points: [number, number][], f: Frame): Float64Array {
  const out: number[] = []
  if (points.length === 0) return new Float64Array(0)
  let px = (points[0][0] - f.lon0) * f.kx
  let py = (points[0][1] - f.lat0) * f.ky
  out.push(px, py)
  let carried = 0 // distance walked since the last emitted step
  for (let i = 1; i < points.length; i++) {
    const x = (points[i][0] - f.lon0) * f.kx
    const y = (points[i][1] - f.lat0) * f.ky
    const seg = Math.hypot(x - px, y - py)
    let at = STEP_M - carried
    while (at <= seg) {
      const t = at / seg
      out.push(px + (x - px) * t, py + (y - py) * t)
      at += STEP_M
    }
    carried = seg - (at - STEP_M)
    px = x
    py = y
  }
  return Float64Array.from(out)
}

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) * KEY_SPAN + (cy + KEY_OFFSET)
}

/** What is kept of a track for comparing it with others. */
export interface Fingerprint {
  lengthM: number
  /** Grid cell -> number of steps in it. */
  cells: Map<number, number>
  /** The cells plus their eight neighbours. */
  near: Set<number>
  steps: number
}

function fingerprintIn(points: [number, number][], f: Frame): Fingerprint {
  const xy = resample(points, f)
  const steps = xy.length / 2
  const cells = new Map<number, number>()
  const near = new Set<number>()
  for (let i = 0; i < steps; i++) {
    const cx = Math.floor(xy[2 * i] / CELL_M)
    const cy = Math.floor(xy[2 * i + 1] / CELL_M)
    const key = cellKey(cx, cy)
    const n = cells.get(key)
    if (n !== undefined) {
      cells.set(key, n + 1)
      continue
    }
    cells.set(key, 1)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.add(cellKey(cx + dx, cy + dy))
  }
  return { lengthM: Math.max(0, steps - 1) * STEP_M, cells, near, steps }
}

/**
 * Fingerprint of one track. Tracks that are to be compared must share `origin` ([lon, lat]),
 * because it fixes the grid.
 */
export function fingerprint(coords: TrackInput['coords'], origin: readonly [number, number]): Fingerprint {
  return fingerprintIn(lonLat(coords), frameAt(origin[0], origin[1]))
}

/** Share of a's length that lies on b; stops early once it cannot reach `atLeast` any more. */
function overlap(a: Fingerprint, b: Fingerprint, atLeast: number): number {
  if (a.steps === 0) return 0
  let missBudget = a.steps * (1 - atLeast)
  for (const [key, n] of a.cells) {
    if (b.near.has(key)) continue
    missBudget -= n
    if (missBudget < 0) return 0
  }
  return atLeast + missBudget / a.steps
}

/**
 * How closely two tracks follow the same route: 0 when they do not (too little of one lies on
 * the other, or their lengths are too different), otherwise mutual overlap times length ratio,
 * so 1 is a perfect match and the lowest score of a match is `minOverlap * minLengthRatio`.
 */
export function similarity(a: Fingerprint, b: Fingerprint, minOverlap = MIN_OVERLAP, minLengthRatio = MIN_LENGTH_RATIO): number {
  const longer = Math.max(a.lengthM, b.lengthM)
  if (longer <= 0) return 0
  const lengthRatio = Math.min(a.lengthM, b.lengthM) / longer
  if (lengthRatio < minLengthRatio) return 0
  const ab = overlap(a, b, minOverlap)
  if (ab < minOverlap) return 0
  const ba = overlap(b, a, minOverlap)
  if (ba < minOverlap) return 0
  return Math.min(ab, ba) * lengthRatio
}

/** Eight-point compass direction of a bearing in degrees clockwise from north. */
export function compass(bearingDeg: number): Compass {
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]
}

/** Compass direction from one [lon, lat] to another and the distance in metres. */
export function offsetBetween(from: readonly [number, number], to: readonly [number, number]): { distanceM: number; heading: Compass } {
  const f = frameAt(from[0], (from[1] + to[1]) / 2)
  const dx = (to[0] - from[0]) * f.kx
  const dy = (to[1] - from[1]) * f.ky
  return { distanceM: Math.hypot(dx, dy), heading: compass(Math.atan2(dx, dy) / RAD) }
}

/** A track ending within this share of its length from its start is closed. */
const CLOSED_GAP_SHARE = 0.15
/** An out-and-back runs at least this share of its length twice, once in each direction. */
const RETRACED_SHARE = 0.7
/** Laps: at least this share of the steps repeat an earlier pass in the same direction (2 laps = 0.5). */
const LAPPED_SHARE = 0.4
/** Steps this close together along the track are the same pass, not a return. */
const SAME_PASS_M = 150
/** A route whose centre of mass is closer to the start than this share of its length has no heading. */
const HEADING_MIN_SHARE = 0.04

/** Shape (see RouteShape) and heading of one track, and its length in metres. */
export function describeTrack(coords: TrackInput['coords']): { shape: RouteShape; heading: Compass | null; lengthM: number } {
  const points = lonLat(coords)
  if (points.length < 2) return { shape: 'one-way', heading: null, lengthM: 0 }
  const xy = resample(points, frameAt(points[0][0], points[0][1]))
  const steps = xy.length / 2
  const lengthM = (steps - 1) * STEP_M
  if (steps < 3) return { shape: 'one-way', heading: null, lengthM }

  // Steps that pass a place the track has been before, heading the other way or the same way.
  const visits = new Map<number, number[]>()
  const minGap = Math.ceil(SAME_PASS_M / STEP_M)
  let returning = 0
  let repeating = 0
  let sx = 0
  let sy = 0
  for (let i = 0; i < steps; i++) {
    const x = xy[2 * i]
    const y = xy[2 * i + 1]
    sx += x
    sy += y
    const a = Math.max(0, i - 1)
    const b = Math.min(steps - 1, i + 1)
    const hx = xy[2 * b] - xy[2 * a]
    const hy = xy[2 * b + 1] - xy[2 * a + 1]
    const cx = Math.floor(x / CELL_M)
    const cy = Math.floor(y / CELL_M)
    let back = false
    let again = false
    for (let dx = -1; dx <= 1 && !(back && again); dx++) {
      for (let dy = -1; dy <= 1 && !(back && again); dy++) {
        const earlier = visits.get(cellKey(cx + dx, cy + dy))
        if (!earlier) continue
        for (const j of earlier) {
          if (i - j < minGap) break // the list is ascending: everything after is closer still
          const ja = Math.max(0, j - 1)
          const jb = Math.min(steps - 1, j + 1)
          const dot = hx * (xy[2 * jb] - xy[2 * ja]) + hy * (xy[2 * jb + 1] - xy[2 * ja + 1])
          if (dot < 0) back = true
          else if (dot > 0) again = true
        }
      }
    }
    if (back) returning++
    if (again) repeating++
    const key = cellKey(cx, cy)
    const list = visits.get(key)
    if (list) list.push(i)
    else visits.set(key, [i])
  }

  const gap = Math.hypot(xy[2 * (steps - 1)], xy[2 * (steps - 1) + 1])
  const closed = gap <= CLOSED_GAP_SHARE * lengthM
  // Each retraced stretch is counted once (on the way back) but covers two passes.
  const shape: RouteShape =
    (2 * returning) / steps >= RETRACED_SHARE ? 'out-and-back' : repeating / steps >= LAPPED_SHARE ? 'laps' : closed ? 'loop' : 'one-way'

  // The start is the frame's origin, so the centre of mass is already the offset from it.
  const mx = sx / steps
  const my = sy / steps
  const heading = Math.hypot(mx, my) >= HEADING_MIN_SHARE * lengthM ? compass(Math.atan2(mx, my) / RAD) : null
  return { shape, heading, lengthM }
}

interface Box {
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
}

function boxOf(points: [number, number][]): Box {
  const b: Box = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity }
  for (const [lon, lat] of points) {
    if (lon < b.minLon) b.minLon = lon
    if (lon > b.maxLon) b.maxLon = lon
    if (lat < b.minLat) b.minLat = lat
    if (lat > b.maxLat) b.maxLat = lat
  }
  return b
}

function grow(b: Box, marginM: number): Box {
  const dLat = marginM / M_PER_DEG
  const dLon = marginM / (M_PER_DEG * Math.max(0.01, Math.cos(((b.minLat + b.maxLat) / 2) * RAD)))
  return { minLon: b.minLon - dLon, maxLon: b.maxLon + dLon, minLat: b.minLat - dLat, maxLat: b.maxLat + dLat }
}

function boxesTouch(a: Box, b: Box): boolean {
  return a.minLon <= b.maxLon && b.minLon <= a.maxLon && a.minLat <= b.maxLat && b.minLat <= a.maxLat
}

/** Connected components of "bounding boxes closer than twice the margin". Returns member indices. */
function areasOf(boxes: Box[], marginM: number): number[][] {
  const grown = boxes.map((b) => grow(b, marginM))
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesTouch(grown[i], grown[j])) parent[find(j)] = find(i)
    }
  }
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < boxes.length; i++) {
    const r = find(i)
    const list = byRoot.get(r)
    if (list) list.push(i)
    else byRoot.set(r, [i])
  }
  return [...byRoot.values()]
}

/**
 * Complete-linkage clustering over a symmetric similarity matrix (row-major, n x n): the two
 * most similar clusters are merged until no pair of clusters has every member pair at or above
 * `threshold`. Returns clusters of indices, each ascending.
 */
export function clusterComplete(sim: ArrayLike<number>, n: number, threshold: number): number[][] {
  // link[i * n + j]: the weakest pair between clusters i and j.
  const link = Float64Array.from(sim)
  const members: (number[] | null)[] = Array.from({ length: n }, (_, i) => [i])
  for (;;) {
    let best = threshold
    let bi = -1
    let bj = -1
    for (let i = 0; i < n; i++) {
      if (!members[i]) continue
      for (let j = i + 1; j < n; j++) {
        if (!members[j]) continue
        const s = link[i * n + j]
        // Strictly better wins, so ties resolve to the earliest pair and the result is stable.
        if (s > best || (bi === -1 && s >= threshold)) {
          best = s
          bi = i
          bj = j
        }
      }
    }
    if (bi === -1) break
    members[bi] = [...(members[bi] as number[]), ...(members[bj] as number[])].sort((a, b) => a - b)
    members[bj] = null
    for (let k = 0; k < n; k++) {
      if (k === bi || !members[k]) continue
      const s = Math.min(link[bi * n + k], link[bj * n + k])
      link[bi * n + k] = s
      link[k * n + bi] = s
    }
  }
  return members.filter((m): m is number[] => m !== null)
}

export interface GroupingOptions {
  minOverlap?: number
  minLengthRatio?: number
  areaMarginM?: number
}

/**
 * Sorts tracks into areas (places far enough apart that they would not share a map) and, inside
 * each area, into groups of tracks that follow the same route. Every track ends up in exactly
 * one group, alone if nothing matches it. Tracks with fewer than two points are left out.
 */
export function groupTracks(tracks: TrackInput[], options: GroupingOptions = {}): Grouping {
  const minOverlap = options.minOverlap ?? MIN_OVERLAP
  const minLengthRatio = options.minLengthRatio ?? MIN_LENGTH_RATIO
  const usable = tracks.map((t) => ({ id: t.id, points: lonLat(t.coords) })).filter((t) => t.points.length >= 2)
  const boxes = usable.map((t) => boxOf(t.points))

  const areaMembers = areasOf(boxes, options.areaMarginM ?? AREA_MARGIN_M)
  // Largest area first; equal sizes keep input order (the sort is stable).
  areaMembers.sort((a, b) => b.length - a.length)

  const areas: TrackArea[] = []
  const groups: TrackGroup[] = []
  areaMembers.forEach((idx, areaIndex) => {
    let box = boxes[idx[0]]
    for (const i of idx) {
      const b = boxes[i]
      box = {
        minLon: Math.min(box.minLon, b.minLon),
        maxLon: Math.max(box.maxLon, b.maxLon),
        minLat: Math.min(box.minLat, b.minLat),
        maxLat: Math.max(box.maxLat, b.maxLat)
      }
    }
    const center: [number, number] = [(box.minLon + box.maxLon) / 2, (box.minLat + box.maxLat) / 2]
    areas.push({ ids: idx.map((i) => usable[i].id), center })

    const frame = frameAt(center[0], center[1])
    const prints = idx.map((i) => fingerprintIn(usable[i].points, frame))
    const n = idx.length
    const sim = new Float64Array(n * n)
    for (let i = 0; i < n; i++) {
      sim[i * n + i] = 1
      for (let j = i + 1; j < n; j++) {
        const s = similarity(prints[i], prints[j], minOverlap, minLengthRatio)
        sim[i * n + j] = s
        sim[j * n + i] = s
      }
    }

    for (const cluster of clusterComplete(sim, n, minOverlap * minLengthRatio)) {
      let rep = cluster[0]
      let repScore = -1
      for (const i of cluster) {
        let score = 0
        for (const j of cluster) score += sim[i * n + j]
        if (score > repScore) {
          repScore = score
          rep = i
        }
      }
      const { shape, heading, lengthM } = describeTrack(usable[idx[rep]].points)
      groups.push({
        ids: cluster.map((i) => usable[idx[i]].id),
        representativeId: usable[idx[rep]].id,
        shape,
        heading,
        lengthM,
        area: areaIndex
      })
    }
  })

  // Clusters come out in input order within an area; a stable sort keeps that for ties.
  groups.sort((a, b) => b.ids.length - a.ids.length)
  return { groups, areas }
}

/**
 * Douglas-Peucker: drops points that lie within `toleranceM` of the line through their
 * neighbours. Returns [lon, lat] pairs rounded to `digits` decimals (5 is about a metre).
 */
export function thinTrack(coords: TrackInput['coords'], toleranceM: number, digits = 5): [number, number][] {
  const points = lonLat(coords)
  const n = points.length
  if (n === 0) return []
  const f = frameAt(points[0][0], points[0][1])
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  const tol2 = toleranceM * toleranceM
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number]
    if (b - a < 2) continue
    const ax = (points[a][0] - f.lon0) * f.kx
    const ay = (points[a][1] - f.lat0) * f.ky
    const dx = (points[b][0] - f.lon0) * f.kx - ax
    const dy = (points[b][1] - f.lat0) * f.ky - ay
    const len2 = dx * dx + dy * dy
    let worst = -1
    let worstAt = -1
    for (let i = a + 1; i < b; i++) {
      const px = (points[i][0] - f.lon0) * f.kx - ax
      const py = (points[i][1] - f.lat0) * f.ky - ay
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
      const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2
      if (d2 > worst) {
        worst = d2
        worstAt = i
      }
    }
    if (worst > tol2) {
      keep[worstAt] = 1
      stack.push([a, worstAt], [worstAt, b])
    }
  }
  const scale = 10 ** digits
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push([Math.round(points[i][0] * scale) / scale, Math.round(points[i][1] * scale) / scale])
  }
  return out
}
