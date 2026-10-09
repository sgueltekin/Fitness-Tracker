// GPX route files: parsing, distance along the track and shape-preserving downsampling.
import { SaxesParser } from 'saxes'
import { parseIsoTs } from './time'

export interface Track {
  lon: number[]
  lat: number[]
  /** Elevation in metres; NaN where the file has none. */
  ele: number[]
  /** Unix seconds; NaN where the file has none. */
  time: number[]
}

/** Reads every <trkpt> of a GPX document, in file order. Points without coordinates are skipped. */
export function parseGpx(xml: string): Track {
  const track: Track = { lon: [], lat: [], ele: [], time: [] }
  const parser = new SaxesParser()
  let inPoint = false
  let field: 'ele' | 'time' | null = null
  let text = ''
  let ele = NaN
  let time = NaN
  let lon = NaN
  let lat = NaN

  parser.on('error', () => {
    // A damaged route file only costs that workout its map; keep what was read so far.
  })
  parser.on('opentag', (tag) => {
    if (tag.name === 'trkpt') {
      inPoint = true
      lon = Number(tag.attributes.lon)
      lat = Number(tag.attributes.lat)
      ele = NaN
      time = NaN
    } else if (inPoint && (tag.name === 'ele' || tag.name === 'time')) {
      field = tag.name
      text = ''
    }
  })
  parser.on('text', (t) => {
    if (field) text += t
  })
  parser.on('closetag', (tag) => {
    if (field && tag.name === field) {
      if (field === 'ele') ele = Number(text)
      else time = parseIsoTs(text)
      field = null
    } else if (tag.name === 'trkpt') {
      inPoint = false
      if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        track.lon.push(lon)
        track.lat.push(lat)
        track.ele.push(Number.isFinite(ele) ? ele : NaN)
        track.time.push(time)
      }
    }
  })
  try {
    parser.write(xml).close()
  } catch {
    // see the error handler above
  }
  return track
}

const EARTH_RADIUS_M = 6_371_008.8
const RAD = Math.PI / 180

export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Cumulative distance in metres at every track point. */
export function cumulativeDistanceM(track: Track): number[] {
  const out = new Array<number>(track.lon.length)
  let sum = 0
  for (let i = 0; i < out.length; i++) {
    if (i > 0) sum += haversineM(track.lon[i - 1], track.lat[i - 1], track.lon[i], track.lat[i])
    out[i] = sum
  }
  return out
}

/**
 * True when the track's timestamps describe the recording: they increase overall and fall
 * into the workout's time range (with some slack). Routes written by third-party apps
 * (Strava) stamp every point with the time the route was saved, which is useless.
 */
export function trackHasUsableTimes(track: Track, startTs: number, endTs: number, slackS = 300): boolean {
  const n = track.time.length
  if (n < 2) return false
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const t = track.time[i]
    if (!Number.isFinite(t)) return false
    if (i > 0 && t < track.time[i - 1]) return false
    if (t < min) min = t
    if (t > max) max = t
  }
  return max > min && min >= startTs - slackS && max <= endTs + slackS
}

/**
 * Indices of at most `maxPoints` points that keep the shape of the line: the points a
 * Douglas-Peucker simplification would drop last. First and last point are always kept.
 */
export function simplifyIndices(x: ArrayLike<number>, y: ArrayLike<number>, maxPoints: number): number[] {
  const n = x.length
  if (n <= maxPoints || n <= 2) return Array.from({ length: n }, (_, i) => i)

  // importance[i]: the tolerance at which point i disappears, capped by its parent's so that
  // keeping the most important points always yields a valid simplification.
  const importance = new Float64Array(n)
  importance[0] = Infinity
  importance[n - 1] = Infinity
  const stack: [number, number, number][] = [[0, n - 1, Infinity]]
  while (stack.length) {
    const [a, b, cap] = stack.pop() as [number, number, number]
    if (b - a < 2) continue
    const ax = x[a]
    const ay = y[a]
    const dx = x[b] - ax
    const dy = y[b] - ay
    const len2 = dx * dx + dy * dy
    let worst = -1
    let worstAt = -1
    for (let i = a + 1; i < b; i++) {
      const px = x[i] - ax
      const py = y[i] - ay
      let d2: number
      if (len2 === 0) d2 = px * px + py * py
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
        const ex = px - t * dx
        const ey = py - t * dy
        d2 = ex * ex + ey * ey
      }
      if (d2 > worst) {
        worst = d2
        worstAt = i
      }
    }
    if (worst <= 0) continue // everything in between lies on the line: importance stays 0
    const value = Math.min(Math.sqrt(worst), cap)
    importance[worstAt] = value
    stack.push([a, worstAt, value], [worstAt, b, value])
  }

  const order = Array.from({ length: n }, (_, i) => i)
  // Ties (e.g. many points with importance 0 on a straight line) resolve by position.
  order.sort((i, j) => importance[j] - importance[i] || i - j)
  return order.slice(0, Math.max(2, maxPoints)).sort((i, j) => i - j)
}

/**
 * The `route` stream: [lon, lat, elevation m, t] with t in seconds from `startTs`, or null
 * where the file carries no usable time. Downsampled to at most `maxPoints` points.
 */
export function routeStream(track: Track, startTs: number, timesUsable: boolean, maxPoints = 1500): (number | null)[][] {
  const n = track.lon.length
  if (n === 0) return []
  // Project to metres around the first point so that the tolerance is isotropic.
  const kx = Math.cos(track.lat[0] * RAD) * RAD * EARTH_RADIUS_M
  const ky = RAD * EARTH_RADIUS_M
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = (track.lon[i] - track.lon[0]) * kx
    y[i] = (track.lat[i] - track.lat[0]) * ky
  }
  return simplifyIndices(x, y, maxPoints).map((i) => [
    round(track.lon[i], 6),
    round(track.lat[i], 6),
    Number.isFinite(track.ele[i]) ? round(track.ele[i], 1) : null,
    timesUsable ? round(track.time[i] - startTs, 1) : null
  ])
}

/** Largest extent of the track in metres (diagonal of its bounding box). */
export function trackExtentM(track: Track): number {
  const n = track.lon.length
  if (n === 0) return 0
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (let i = 0; i < n; i++) {
    if (track.lon[i] < minLon) minLon = track.lon[i]
    if (track.lon[i] > maxLon) maxLon = track.lon[i]
    if (track.lat[i] < minLat) minLat = track.lat[i]
    if (track.lat[i] > maxLat) maxLat = track.lat[i]
  }
  return haversineM(minLon, minLat, maxLon, maxLat)
}

function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}
