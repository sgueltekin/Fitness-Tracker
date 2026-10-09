// The same session often appears several times in a Health export: recorded by one app,
// written back by another (Strava), or typed in by hand. Keep one workout per session.
import type { RawWorkout } from './types'

export function workoutUid(w: Pick<RawWorkout, 'activityType' | 'startTs' | 'source'>): string {
  return `${w.activityType}|${w.startTs}|${w.source}`
}

export function isStravaCopy(w: Pick<RawWorkout, 'source' | 'externalUuid'>): boolean {
  return /^strava$/i.test(w.source) || /^strava:/i.test(w.externalUuid ?? '')
}

/** Overlap of two time ranges as a fraction of the shorter one (0..1). */
export function overlapFraction(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const shorter = Math.min(aEnd - aStart, bEnd - bStart)
  if (shorter <= 0) {
    // A zero-length workout counts as overlapping when it lies inside the other one.
    const [pStart, qStart, qEnd] = aEnd - aStart <= 0 ? [aStart, bStart, bEnd] : [bStart, aStart, aEnd]
    return pStart >= qStart && pStart <= qEnd ? 1 : 0
  }
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart)
  return overlap <= 0 ? 0 : overlap / shorter
}

/** Same sport and time ranges that overlap by more than half of the shorter one. */
export function isSameSession(a: RawWorkout, b: RawWorkout): boolean {
  if (a.sport !== b.sport) return false
  // 'other' lumps unrelated activity types together; those only match their own type.
  if (a.sport === 'other' && a.activityType !== b.activityType) return false
  return overlapFraction(a.startTs, a.endTs, b.startTs, b.endTs) > 0.5
}

/**
 * Lower is better: a titled recording (Runna), an Apple Watch recording, anything else,
 * a copy written back by Strava, a workout the user typed in.
 */
export function sourceRank(w: RawWorkout): number {
  if (w.userEntered) return 4
  if (isStravaCopy(w)) return 3
  if (w.title) return 0
  if (w.fromWatch) return 1
  return 2
}

function preferenceOrder(a: RawWorkout, b: RawWorkout): number {
  return (
    sourceRank(a) - sourceRank(b) ||
    Number(b.routePath !== null) - Number(a.routePath !== null) ||
    Number(b.avgHr !== null) - Number(a.avgHr !== null) ||
    b.events.length - a.events.length ||
    b.endTs - b.startTs - (a.endTs - a.startTs) ||
    a.startTs - b.startTs ||
    (workoutUid(a) < workoutUid(b) ? -1 : workoutUid(a) > workoutUid(b) ? 1 : 0)
  )
}

/** Fills what `kept` lacks from a dropped copy of the same session. */
function fillFrom(kept: RawWorkout, dropped: RawWorkout): void {
  if (kept.routePath === null) kept.routePath = dropped.routePath
  if (kept.avgHr === null && dropped.avgHr !== null) {
    kept.avgHr = dropped.avgHr
    kept.minHr = dropped.minHr
    kept.maxHr = dropped.maxHr
  }
  if (kept.zones.length === 0 && dropped.zones.length > 0) kept.zones = dropped.zones
  kept.distanceM ??= dropped.distanceM
  kept.title ??= dropped.title
  kept.avgPowerW ??= dropped.avgPowerW
  kept.avgStrideM ??= dropped.avgStrideM
  kept.avgGctMs ??= dropped.avgGctMs
  kept.avgVertOscCm ??= dropped.avgVertOscCm
  kept.stepCount ??= dropped.stepCount
  kept.elevationGainM ??= dropped.elevationGainM
  kept.effort ??= dropped.effort
  // Energy typed in by hand is a guess; only take it from a recording.
  if (!dropped.userEntered) kept.energyKcal ??= dropped.energyKcal
}

export interface DedupeResult {
  /** One workout per session, sorted by start time. Copies of the input objects. */
  kept: RawWorkout[]
  duplicatesSkipped: number
}

/**
 * Goes through the workouts from most to least preferred and keeps each one unless it is
 * the same session as one already kept, in which case it only donates what that one lacks.
 */
export function dedupeWorkouts(workouts: RawWorkout[]): DedupeResult {
  const ordered = workouts.map((w) => ({ ...w })).sort(preferenceOrder)
  const kept: RawWorkout[] = []
  const uids = new Set<string>()
  let duplicatesSkipped = 0
  for (const w of ordered) {
    let match: RawWorkout | null = null
    let matchOverlap = 0
    for (const k of kept) {
      if (!isSameSession(k, w)) continue
      const f = overlapFraction(k.startTs, k.endTs, w.startTs, w.endTs)
      if (f > matchOverlap) {
        match = k
        matchOverlap = f
      }
    }
    const uid = workoutUid(w)
    if (!match && uids.has(uid)) match = kept.find((k) => workoutUid(k) === uid) ?? null
    if (match) {
      fillFrom(match, w)
      duplicatesSkipped++
    } else {
      kept.push(w)
      uids.add(uid)
    }
  }
  kept.sort((a, b) => a.startTs - b.startTs || (workoutUid(a) < workoutUid(b) ? -1 : 1))
  return { kept, duplicatesSkipped }
}
