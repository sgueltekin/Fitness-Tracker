// The Running page's query against a small, entirely made-up set of workouts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db'
import { bucketOf, bucketStarts, effortStats, getRunning, pickBucket } from '../src/main/queries/running'

describe('buckets', () => {
  it('maps a date to its week, month and quarter', () => {
    expect(bucketOf('2024-05-16', 'week')).toBe('2024-05-13')
    expect(bucketOf('2024-05-16', 'month')).toBe('2024-05-01')
    expect(bucketOf('2024-05-16', 'quarter')).toBe('2024-04-01')
    expect(bucketOf('2024-12-31', 'quarter')).toBe('2024-10-01')
    expect(bucketOf('2024-01-01', 'quarter')).toBe('2024-01-01')
  })

  it('lists every bucket of a span, across a year end', () => {
    expect(bucketStarts('2023-11-20', '2024-02-03', 'month')).toEqual(['2023-11-01', '2023-12-01', '2024-01-01', '2024-02-01'])
    expect(bucketStarts('2023-11-20', '2024-04-01', 'quarter')).toEqual(['2023-10-01', '2024-01-01', '2024-04-01'])
    expect(bucketStarts('2024-05-16', '2024-05-27', 'week')).toEqual(['2024-05-13', '2024-05-20', '2024-05-27'])
  })

  it('uses weeks up to a year, months up to three years, then quarters', () => {
    expect(pickBucket('2023-06-05', '2024-05-31')).toBe('week')
    expect(pickBucket('2023-01-02', '2024-05-31')).toBe('month')
    expect(pickBucket('2021-06-01', '2024-05-31')).toBe('month')
    expect(pickBucket('2019-03-04', '2024-05-31')).toBe('quarter')
  })
})

describe('effortStats', () => {
  it('weights pace by distance and heart rate by duration', () => {
    const s = effortStats([
      { distance_m: 2000, duration_s: 1000, avg_hr: 150 },
      { distance_m: 8000, duration_s: 3000, avg_hr: 130 }
    ])
    expect(s.runs).toBe(2)
    expect(s.paceSPerKm).toBe(400) // 4000 s over 10 km, not the mean of 500 and 375
    expect(s.avgHr).toBe(135)
    expect(s.hrRuns).toBe(2)
  })

  it('leaves out what is missing instead of counting it as zero', () => {
    const s = effortStats([
      { distance_m: 5000, duration_s: 1500, avg_hr: null },
      { distance_m: null, duration_s: 1200, avg_hr: 140 }
    ])
    expect(s.paceSPerKm).toBe(300)
    expect(s.avgHr).toBe(140)
    expect(s.hrRuns).toBe(1)
    expect(effortStats([])).toEqual({ runs: 0, paceSPerKm: null, hrRuns: 0, avgHr: null })
  })
})

describe('getRunning', () => {
  const TODAY = '2024-05-31' // a Friday
  let db: Db
  let pinned: string | undefined
  let seq = 0
  let ids: Record<string, number>

  function workout(date: string, category: string, distanceM: number | null, durationS: number, avgHr: number | null = null, sport = 'run'): number {
    const ts = Date.parse(`${date}T08:00:00Z`) / 1000 + seq
    const res = db
      .prepare(
        `INSERT INTO workouts (uid, sport, activity_type, category, title, source, start_ts, end_ts, tz_offset_min, local_date, duration_s, distance_m, avg_hr)
         VALUES (?, ?, 'Test', ?, NULL, 'Test', ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(`uid-${++seq}`, sport, category, ts, ts + durationS, date, durationS, distanceM, avgHr)
    return Number(res.lastInsertRowid)
  }
  const best = (id: number, distanceM: number, durationS: number): void => {
    db.prepare('INSERT INTO best_efforts (workout_id, distance_m, duration_s, start_offset_s) VALUES (?, ?, ?, 0)').run(id, distanceM, durationS)
  }
  /** Seconds in zones 1 to 5, with the four limits between them. */
  const zones = (id: number, seconds: number[], limits: number[]): void => {
    seconds.forEach((s, i) => {
      db.prepare('INSERT INTO hr_zones (workout_id, zone, min_bpm, max_bpm, seconds) VALUES (?, ?, ?, ?, ?)').run(id, i + 1, limits[i - 1] ?? null, limits[i] ?? null, s)
    })
  }

  beforeAll(() => {
    pinned = process.env.FD_NOW
    process.env.FD_NOW = TODAY
    db = openDatabase(':memory:')
    ids = {
      old: workout('2019-03-05', 'other', 3000, 1500),
      // Previous 28-day window: 6 Apr to 3 May.
      easyBefore: workout('2024-04-10', 'easy', 4000, 2000),
      longBefore: workout('2024-04-20', 'long', 8000, 4000),
      // Current 28-day window: 4 May to 31 May.
      walkrun: workout('2024-05-06', 'walkrun', 2000, 1400),
      easyPhone: workout('2024-05-07', 'easy', 5000, 2000),
      tempo: workout('2024-05-15', 'tempo', 6000, 2100, 165),
      intervals: workout('2024-05-17', 'other', 7000, 2800, 160),
      easyWatch: workout('2024-05-21', 'easy', 5000, 2400, 140),
      long: workout('2024-05-26', 'long', 12000, 5400, 150),
      easyToday: workout(TODAY, 'easy', 6000, 2400, 130),
      walk: workout('2024-05-22', 'walk', 9000, 6000, 100, 'walk')
    }
    // A manual category wins over the derived one.
    db.prepare('INSERT INTO workout_overrides (uid, category) SELECT uid, ? FROM workouts WHERE id = ?').run('intervals', ids.intervals)

    best(ids.old, 1000, 480)
    best(ids.tempo, 1000, 300)
    best(ids.long, 1000, 320)
    best(ids.tempo, 5000, 1700)
    best(ids.long, 5000, 1650)
    best(ids.long, 10000, 4400)
    best(ids.walk, 1000, 100)

    zones(ids.tempo, [100, 200, 800, 1000, 0], [130, 145, 160, 175])
    zones(ids.easyToday, [400, 1900, 100, 0, 0], [128, 143, 158, 173])
    zones(ids.walk, [6000, 0, 0, 0, 0], [128, 143, 158, 173])
    zones(ids.longBefore, [0, 3000, 1000, 0, 0], [130, 145, 160, 175])
  })

  afterAll(() => {
    db.close()
    if (pinned === undefined) delete process.env.FD_NOW
    else process.env.FD_NOW = pinned
  })

  it('covers whole weeks ending today and counts only runs', () => {
    const d = getRunning(db, '4w')
    expect(d.from).toBe('2024-05-06')
    expect(d.to).toBe(TODAY)
    expect(d.totals).toEqual({ runs: 7, distanceM: 43000, durationS: 18500 })
    expect(d.longest?.id).toBe(ids.long)
  })

  it('stacks distance per week by category after overrides, keeping empty weeks', () => {
    const d = getRunning(db, '12w')
    expect(d.distance.bucket).toBe('week')
    expect(d.distance.buckets).toHaveLength(12)
    expect(d.distance.buckets[0]).toEqual({ start: '2024-03-11', runs: 0, byCategory: {} })
    const week = (start: string) => d.distance.buckets.find((b) => b.start === start)
    expect(week('2024-05-06')).toEqual({ start: '2024-05-06', runs: 2, byCategory: { walkrun: 2000, easy: 5000 } })
    expect(week('2024-05-13')).toEqual({ start: '2024-05-13', runs: 2, byCategory: { tempo: 6000, intervals: 7000 } })
    expect(week('2024-05-27')).toEqual({ start: '2024-05-27', runs: 1, byCategory: { easy: 6000 } })
  })

  it('switches to quarters when the range spans years', () => {
    const d = getRunning(db, 'all')
    expect(d.from).toBe('2019-03-04')
    expect(d.distance.bucket).toBe('quarter')
    expect(d.distance.buckets).toHaveLength(22)
    expect(d.distance.buckets[0]).toEqual({ start: '2019-01-01', runs: 1, byCategory: { other: 3000 } })
    expect(d.distance.buckets.at(-1)).toMatchObject({ start: '2024-04-01', runs: 9 })
  })

  it('compares the last 28 days with the 28 before, whatever the range', () => {
    for (const range of ['4w', 'all'] as const) {
      const { recent } = getRunning(db, range)
      expect(recent.days).toBe(28)
      expect(recent.weeklyDistanceM).toEqual({ now: 43000 / 4, before: 12000 / 4 })
      // Easy runs only: the walk-run and the faster sessions stay out of the pace.
      expect(recent.easyPaceSPerKm).toEqual({ now: 425, before: 500 })
      // Only the two watch-recorded easy runs count; nothing before had heart rate.
      expect(recent.easyHr).toEqual({ now: 135, before: null })
      expect(recent.easyRuns).toBe(3)
    }
  })

  it('finds the all-time best per distance among runs', () => {
    expect(getRunning(db, '4w').bests).toEqual([
      { distanceM: 1000, durationS: 300, workoutId: ids.tempo, date: '2024-05-15' },
      { distanceM: 5000, durationS: 1650, workoutId: ids.long, date: '2024-05-26' },
      { distanceM: 10000, durationS: 4400, workoutId: ids.long, date: '2024-05-26' },
      { distanceM: 21097, durationS: null, workoutId: null, date: null }
    ])
  })

  it('starts the easy trend at the first easy run and leaves gaps as nulls', () => {
    const { easyTrend } = getRunning(db, '12w')
    expect(easyTrend.bucket).toBe('week')
    expect(easyTrend.points.map((p) => p.start)).toEqual([
      '2024-04-08', '2024-04-15', '2024-04-22', '2024-04-29', '2024-05-06', '2024-05-13', '2024-05-20', '2024-05-27'
    ])
    expect(easyTrend.points[0]).toEqual({ start: '2024-04-08', runs: 1, paceSPerKm: 500, hrRuns: 0, avgHr: null })
    expect(easyTrend.points[1]).toEqual({ start: '2024-04-15', runs: 0, paceSPerKm: null, hrRuns: 0, avgHr: null })
    expect(easyTrend.points[6]).toEqual({ start: '2024-05-20', runs: 1, paceSPerKm: 480, hrRuns: 1, avgHr: 140 })
    expect(getRunning(db, '4w').easyTrend.points[0].start).toBe('2024-05-06')
  })

  it('sums zone time over the runs in range and takes limits from the latest', () => {
    const d = getRunning(db, '4w')
    expect(d.zones.runsWithZones).toBe(2)
    expect(d.zones.zones.map((z) => z.seconds)).toEqual([500, 2100, 900, 1000, 0])
    expect(d.zones.zones[0]).toMatchObject({ zone: 1, minBpm: null, maxBpm: 128 })
    expect(d.zones.zones[4]).toMatchObject({ zone: 5, minBpm: 173, maxBpm: null })
    expect(getRunning(db, '12w').zones.runsWithZones).toBe(3)
  })

  it('lists key sessions newest first', () => {
    expect(getRunning(db, '4w').keySessions.map((w) => w.id)).toEqual([ids.long, ids.intervals, ids.tempo])
    expect(getRunning(db, '12w').keySessions.map((w) => w.id)).toEqual([ids.long, ids.intervals, ids.tempo, ids.longBefore])
    expect(getRunning(db, '4w').keySessions[1].category).toBe('intervals')
  })

  it('returns an empty but complete shape when there are no runs', () => {
    const empty = openDatabase(':memory:')
    const d = getRunning(empty, '12w')
    empty.close()
    expect(d.totals.runs).toBe(0)
    expect(d.longest).toBeNull()
    expect(d.distance.buckets).toHaveLength(12)
    expect(d.easyTrend.points).toEqual([])
    expect(d.zones).toEqual({ runsWithZones: 0, zones: [] })
    expect(d.keySessions).toEqual([])
    expect(d.bests.every((b) => b.durationS == null)).toBe(true)
    expect(d.recent.easyPaceSPerKm).toEqual({ now: null, before: null })
  })
})
