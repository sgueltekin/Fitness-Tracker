// Builds a workout's time series from the sample tables collected during the XML pass.
import type { NumTable } from './collect'
import { cumulativeDistanceM, type Track } from './gpx'
import type { Pt } from './types'

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * Samples of a [ts, value, source] table inside [startTs, endTs] as [offset, value].
 * When several sources measured during the workout, the one with the most samples is used.
 */
export function sampleStream(table: NumTable, startTs: number, endTs: number): Pt[] {
  const lo = table.lowerBound(startTs)
  const counts = new Map<number, number>()
  let hi = lo
  for (; hi < table.length && table.get(hi, 0) <= endTs; hi++) {
    const src = table.get(hi, 2)
    counts.set(src, (counts.get(src) ?? 0) + 1)
  }
  let source = -1
  let most = 0
  for (const [src, n] of counts) {
    if (n > most || (n === most && src < source)) {
      source = src
      most = n
    }
  }
  const out: Pt[] = []
  for (let i = lo; i < hi; i++) {
    if (table.get(i, 2) !== source) continue
    const t = round1(table.get(i, 0) - startTs)
    const v = round1(table.get(i, 1))
    const last = out[out.length - 1]
    if (last && last[0] === t) last[1] = v
    else out.push([t, v])
  }
  return out
}

/** Records longer than this are too coarse to say anything about a workout. */
const MAX_RECORD_SPAN_S = 6 * 3600

/**
 * How finely a source logged distance during a workout.
 * - detailed: a sample every few seconds (a watch, or an app recording the run)
 * - coarse:   a handful of blocks of several minutes (the iPhone's pedometer)
 * - summary:  one record for more or less the whole workout (Strava's copy, a manual
 *             entry); it only restates the total and says nothing about pace
 */
export type DistanceResolution = 'detailed' | 'coarse' | 'summary'

/** One source's distance records during a workout. */
export interface DistanceCandidate {
  sourceId: number
  /** Metres inside the workout's time range. */
  totalM: number
  records: number
  /** Duration of the longest record, in seconds. */
  longestS: number
  /** Cumulative metres as [offset, metres], starting at offset 0. */
  stream: Pt[]
}

export function distanceResolution(c: Pick<DistanceCandidate, 'records' | 'longestS'>, elapsedS: number): DistanceResolution {
  if (c.records < 3 || c.longestS > elapsedS / 2) return 'summary'
  return c.records >= elapsedS / 30 ? 'detailed' : 'coarse'
}

/**
 * Which source's distance records to use: the workout's own source when it logged distance
 * during the workout, otherwise the single source whose total is closest to the workout's
 * distance (the largest total when the workout has no distance). Never a mix of sources:
 * phone, watch and apps each log the same metres.
 */
export function pickDistanceSource(totals: Map<number, number>, ownSourceId: number, workoutDistanceM: number | null): number | null {
  if ((totals.get(ownSourceId) ?? 0) > 0) return ownSourceId
  let best: number | null = null
  let bestScore = Infinity
  for (const [src, total] of totals) {
    if (!(total > 0)) continue
    const score = workoutDistanceM !== null ? Math.abs(total - workoutDistanceM) : -total
    if (score < bestScore || (score === bestScore && best !== null && src < best)) {
      best = src
      bestScore = score
    }
  }
  return best
}

function overlapShare(s: number, e: number, startTs: number, endTs: number): number {
  if (e <= s) return s >= startTs && s <= endTs ? 1 : 0
  const overlap = Math.min(e, endTs) - Math.max(s, startTs)
  return overlap <= 0 ? 0 : overlap / (e - s)
}

/**
 * Per source, the cumulative metres from its distance records ([start, end, metres, source])
 * that fall into the workout. A record that only partly overlaps the workout contributes
 * in proportion; time without records stays flat.
 */
export function distanceCandidates(table: NumTable, startTs: number, endTs: number): DistanceCandidate[] {
  const bySource = new Map<number, DistanceCandidate>()
  const first = table.lowerBound(startTs - MAX_RECORD_SPAN_S)
  for (let i = first; i < table.length && table.get(i, 0) <= endTs; i++) {
    const s = table.get(i, 0)
    const e = table.get(i, 1)
    if (e - s > MAX_RECORD_SPAN_S) continue
    const share = overlapShare(s, e, startTs, endTs)
    if (share <= 0) continue
    const sourceId = table.get(i, 3)
    let c = bySource.get(sourceId)
    if (!c) bySource.set(sourceId, (c = { sourceId, totalM: 0, records: 0, longestS: 0, stream: [] }))
    const pts = c.stream
    const from = Math.max(s, startTs) - startTs
    const to = Math.min(e, endTs) - startTs
    const last = pts[pts.length - 1]
    if (!last) {
      if (from > 0) pts.push([0, 0])
      pts.push([from, 0])
    } else if (from > last[0]) {
      pts.push([from, c.totalM]) // nothing was logged since the previous record: flat
    }
    c.totalM += table.get(i, 2) * share
    c.records++
    c.longestS = Math.max(c.longestS, e - s)
    const tail = pts[pts.length - 1]
    if (to > tail[0]) pts.push([to, c.totalM])
    else tail[1] = c.totalM
  }
  const out: DistanceCandidate[] = []
  for (const c of bySource.values()) {
    if (c.stream.length < 2 || !(c.totalM > 0)) continue
    c.stream = c.stream.map(([t, d]) => [round1(t), round1(d)] as Pt)
    out.push(c)
  }
  return out.sort((a, b) => a.sourceId - b.sourceId)
}

/** The candidate to use among `candidates`, by the rule of pickDistanceSource. */
export function chooseDistanceCandidate(
  candidates: DistanceCandidate[],
  ownSourceId: number,
  workoutDistanceM: number | null
): DistanceCandidate | null {
  const totals = new Map<number, number>()
  for (const c of candidates) totals.set(c.sourceId, c.totalM)
  const id = pickDistanceSource(totals, ownSourceId, workoutDistanceM)
  return candidates.find((c) => c.sourceId === id) ?? null
}

/**
 * Cumulative metres along a GPS track whose timestamps are usable, as a fallback when no
 * source logged detailed distance records. Thinned to about `maxPoints` points.
 */
export function distanceFromTrack(track: Track, startTs: number, endTs: number, maxPoints = 2000): Pt[] {
  const cum = cumulativeDistanceM(track)
  const n = cum.length
  if (n < 2) return []
  const step = Math.max(1, Math.ceil(n / maxPoints))
  const total = endTs - startTs
  const pts: Pt[] = []
  for (let i = 0; i < n; i += step) {
    const at = i + step >= n ? n - 1 : i
    const t = round1(Math.min(Math.max(track.time[at] - startTs, 0), total))
    const d = round1(cum[at])
    const last = pts[pts.length - 1]
    if (last && t <= last[0]) last[1] = Math.max(last[1], d)
    else pts.push([t, d])
    if (at === n - 1) break
  }
  if (pts.length && pts[0][0] > 0) pts.unshift([0, 0])
  return pts.length >= 2 ? pts : []
}

/** Rescales a cumulative distance stream so that it ends at `totalM`. */
export function scaleStream(stream: Pt[], totalM: number): Pt[] {
  const end = stream.length ? stream[stream.length - 1][1] : 0
  if (!(end > 0) || !(totalM > 0)) return stream
  const f = totalM / end
  return stream.map(([t, d]) => [t, round1(d * f)] as Pt)
}
