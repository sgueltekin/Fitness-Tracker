import { describe, expect, it } from 'vitest'
import { dedupeWorkouts, isSameSession, overlapFraction, sourceRank, workoutUid } from '../src/main/import/dedupe'
import type { RawWorkout } from '../src/main/import/types'

const T0 = 1_700_000_000

/** A 30-minute run from an unnamed app; override what the case needs. */
function workout(over: Partial<RawWorkout> = {}): RawWorkout {
  const source = over.source ?? 'SomeApp'
  return {
    activityType: 'Running',
    sport: 'run',
    sourceRaw: source,
    source,
    startTs: T0,
    endTs: T0 + 1800,
    tzOffsetMin: 60,
    durationS: 1800,
    title: null,
    indoor: false,
    userEntered: false,
    externalUuid: null,
    fromWatch: false,
    distanceM: null,
    energyKcal: null,
    avgHr: null,
    minHr: null,
    maxHr: null,
    avgPowerW: null,
    avgStrideM: null,
    avgGctMs: null,
    avgVertOscCm: null,
    stepCount: null,
    elevationGainM: null,
    effort: null,
    events: [],
    zones: [],
    routePath: null,
    ...over
  }
}

describe('overlap', () => {
  it('is measured against the shorter workout', () => {
    expect(overlapFraction(0, 100, 0, 100)).toBe(1)
    expect(overlapFraction(0, 100, 50, 150)).toBe(0.5)
    expect(overlapFraction(0, 3600, 600, 660)).toBe(1) // a minute inside an hour
    expect(overlapFraction(0, 100, 100, 200)).toBe(0)
    expect(overlapFraction(0, 100, 500, 600)).toBe(0)
  })

  it('needs more than half of the shorter one and the same sport', () => {
    const a = workout()
    expect(isSameSession(a, workout({ startTs: T0 + 800, endTs: T0 + 2600 }))).toBe(true) // 1000 of 1800 s
    expect(isSameSession(a, workout({ startTs: T0 + 900, endTs: T0 + 2700 }))).toBe(false) // exactly half
    expect(isSameSession(a, workout({ sport: 'strength', activityType: 'FunctionalStrengthTraining' }))).toBe(false)
    expect(isSameSession(workout({ sport: 'other', activityType: 'Cooldown' }), workout({ sport: 'other', activityType: 'Yoga' }))).toBe(false)
  })
})

describe('which copy to keep', () => {
  it('ranks titled, watch, other, Strava copy, typed in by hand', () => {
    expect(sourceRank(workout({ title: '5 km Easy Run' }))).toBe(0)
    expect(sourceRank(workout({ fromWatch: true }))).toBe(1)
    expect(sourceRank(workout())).toBe(2)
    expect(sourceRank(workout({ source: 'Strava' }))).toBe(3)
    expect(sourceRank(workout({ externalUuid: 'strava://activities/1' }))).toBe(3)
    expect(sourceRank(workout({ userEntered: true, title: 'Typed' }))).toBe(4)
  })

  it('keeps the titled original and drops the copy written back by Strava', () => {
    const original = workout({ source: 'RunApp', title: '5 km Easy Run', distanceM: 5000, routePath: '/workout-routes/a.gpx' })
    const copy = workout({ source: 'Strava', externalUuid: 'strava://activities/1', distanceM: 5001, endTs: T0 + 1795 })
    const { kept, duplicatesSkipped } = dedupeWorkouts([copy, original])
    expect(duplicatesSkipped).toBe(1)
    expect(kept.map(workoutUid)).toEqual([`Running|${T0}|RunApp`])
    expect(kept[0].distanceM).toBe(5000)
  })

  it('prefers a watch recording over an unnamed app, and anything over a manual entry', () => {
    const watch = workout({ source: 'Test Watch', fromWatch: true })
    const app = workout({ source: 'OtherApp' })
    const typed = workout({ source: 'Fitness', userEntered: true, startTs: T0 + 30 })
    const { kept, duplicatesSkipped } = dedupeWorkouts([typed, app, watch])
    expect(kept.map((w) => w.source)).toEqual(['Test Watch'])
    expect(duplicatesSkipped).toBe(2)
  })

  it('fills what the kept workout lacks from the dropped ones', () => {
    const titled = workout({ source: 'RunApp', title: 'Tempo', energyKcal: 300 })
    const strava = workout({
      source: 'Strava',
      distanceM: 5000,
      routePath: '/workout-routes/b.gpx',
      avgHr: 150,
      minHr: 100,
      maxHr: 180,
      zones: [{ minBpm: null, maxBpm: 140, seconds: 60 }],
      energyKcal: 999
    })
    const typed = workout({ source: 'Fitness', userEntered: true, energyKcal: 1, effort: 7 })
    const { kept } = dedupeWorkouts([titled, strava, typed])
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({
      source: 'RunApp',
      title: 'Tempo',
      distanceM: 5000,
      routePath: '/workout-routes/b.gpx',
      avgHr: 150,
      minHr: 100,
      maxHr: 180,
      energyKcal: 300,
      effort: 7
    })
    expect(kept[0].zones).toHaveLength(1)
    // the inputs are left alone
    expect(titled.distanceM).toBeNull()
  })

  it('drops a one-minute entry inside a real run but keeps a second run right after it', () => {
    const run = workout({ source: 'Strava', distanceM: 3400 })
    const junk = workout({ source: 'Fitness', userEntered: true, startTs: T0 + 780, endTs: T0 + 840, distanceM: 10 })
    const second = workout({ source: 'Strava', startTs: T0 + 1860, endTs: T0 + 2200, distanceM: 600 })
    const { kept, duplicatesSkipped } = dedupeWorkouts([run, junk, second])
    expect(duplicatesSkipped).toBe(1)
    expect(kept.map((w) => w.startTs)).toEqual([T0, T0 + 1860])
    expect(kept[0].distanceM).toBe(3400)
  })

  it('does not chain: two separate sessions inside one long copy stay separate', () => {
    const morning = workout({ source: 'RunApp', title: 'Part 1', endTs: T0 + 1200 })
    const later = workout({ source: 'RunApp', title: 'Part 2', startTs: T0 + 2400, endTs: T0 + 3600 })
    const umbrella = workout({ source: 'Strava', endTs: T0 + 3600 })
    const { kept, duplicatesSkipped } = dedupeWorkouts([umbrella, later, morning])
    expect(kept.map((w) => w.title)).toEqual(['Part 1', 'Part 2'])
    expect(duplicatesSkipped).toBe(1)
  })

  it('never keeps two workouts with the same uid, and leaves different sports alone', () => {
    const a = workout({ startTs: T0, endTs: T0 })
    const b = workout({ startTs: T0, endTs: T0 })
    const gym = workout({ sport: 'strength', activityType: 'FunctionalStrengthTraining' })
    const { kept, duplicatesSkipped } = dedupeWorkouts([a, b, gym])
    expect(kept).toHaveLength(2)
    expect(duplicatesSkipped).toBe(1)
    expect(new Set(kept.map(workoutUid)).size).toBe(2)
  })

  it('returns the kept workouts in start order whatever the input order', () => {
    const list = [3, 1, 2].map((d) => workout({ source: 'RunApp', startTs: T0 + d * 86_400, endTs: T0 + d * 86_400 + 600 }))
    expect(dedupeWorkouts(list).kept.map((w) => w.startTs)).toEqual([1, 2, 3].map((d) => T0 + d * 86_400))
  })
})
