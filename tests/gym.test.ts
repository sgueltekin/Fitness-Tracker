import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db'
import { getGym, monthStartsBetween, weekStreak } from '../src/main/queries/gym'

// All values here are invented.

interface Session {
  date: string
  minutes: number
  hr?: number
  maxHr?: number
  kcal?: number
  effort?: number
  sport?: string
}

function insert(db: Db, s: Session, n: number): void {
  const start = Date.UTC(Number(s.date.slice(0, 4)), Number(s.date.slice(5, 7)) - 1, Number(s.date.slice(8)), 17) / 1000
  db.prepare(
    `INSERT INTO workouts (uid, sport, activity_type, category, source, start_ts, end_ts, tz_offset_min, local_date,
                           duration_s, energy_kcal, avg_hr, max_hr, effort)
     VALUES (?, ?, 'FunctionalStrengthTraining', ?, 'Test Watch', ?, ?, 0, ?, ?, ?, ?, ?, ?)`
  ).run(
    `u${n}`,
    s.sport ?? 'strength',
    s.sport ?? 'strength',
    start,
    start + s.minutes * 60,
    s.date,
    s.minutes * 60,
    s.kcal ?? null,
    s.hr ?? null,
    s.maxHr ?? null,
    s.effort ?? null
  )
}

describe('gym helpers', () => {
  it('lists the first of each month across a year boundary', () => {
    expect(monthStartsBetween('2023-11-15', '2024-02-03')).toEqual(['2023-11-01', '2023-12-01', '2024-01-01', '2024-02-01'])
  })

  it('counts a streak back from the current week and stops at the first empty week', () => {
    // Friday 2024-03-15 is in the week of Monday 2024-03-11.
    const weeks = new Set(['2024-03-11', '2024-03-04', '2024-02-26', '2024-02-12'])
    expect(weekStreak(weeks, '2024-03-15')).toBe(3)
  })

  it('does not let a current week without a session break the streak', () => {
    const weeks = new Set(['2024-03-04', '2024-02-26'])
    expect(weekStreak(weeks, '2024-03-12')).toBe(2)
    expect(weekStreak(weeks, '2024-03-19')).toBe(0)
  })
})

describe('getGym', () => {
  let db: Db
  const savedNow = process.env.FD_NOW

  beforeAll(() => {
    process.env.FD_NOW = '2024-03-15'
    db = openDatabase(':memory:')
    const sessions: Session[] = [
      // Long before the range: only 'all' sees it. Logged by an app that writes a token energy value.
      { date: '2022-06-07', minutes: 100, kcal: 4 },
      // The 4 weeks before the 4-week range (2024-02-19 .. 2024-03-15).
      { date: '2024-02-01', minutes: 50, hr: 100, maxHr: 140, kcal: 300, effort: 4 },
      // Inside the range.
      { date: '2024-02-20', minutes: 60, hr: 110, maxHr: 150, kcal: 400, effort: 6 },
      { date: '2024-02-22', minutes: 30 },
      { date: '2024-03-05', minutes: 90, hr: 120, maxHr: 160, kcal: 500, effort: 7 },
      // Not strength: never counted.
      { date: '2024-03-06', minutes: 40, hr: 150, sport: 'run' }
    ]
    sessions.forEach((s, i) => insert(db, s, i))
  })

  afterAll(() => {
    db.close()
    if (savedNow === undefined) delete process.env.FD_NOW
    else process.env.FD_NOW = savedNow
  })

  it('summarises the sessions in the range', () => {
    const g = getGym(db, '4w')
    expect(g.range).toEqual({ from: '2024-02-19', to: '2024-03-15', weeks: 4 })
    expect(g.totalSessions).toBe(5)
    expect(g.lastSessionDate).toBe('2024-03-05')
    expect(g.summary.sessions).toBe(3)
    expect(g.summary.prevSessions).toBe(1)
    expect(g.summary.weeksTrained).toBe(2)
    expect(g.summary.totalDurationS).toBe(180 * 60)
    expect(g.summary.avgDurationS).toBe(60 * 60)
    expect(g.summary.longest?.date).toBe('2024-03-05')
    // Week of 2024-03-11 is empty and still running, 03-04 has a session, 02-26 has none.
    expect(g.summary.streakWeeks).toBe(1)
  })

  it('averages heart rate over the sessions that have one and never treats a missing one as zero', () => {
    const g = getGym(db, '4w')
    expect(g.summary.hrSessions).toBe(2)
    expect(g.summary.avgHr).toBe(115)
    expect(g.sessions.map((s) => s.avgHr)).toEqual([110, null, 120])
    expect(g.sessions.map((s) => s.effort)).toEqual([6, null, 7])
    expect(g.table.map((w) => w.avgHr)).toEqual([120, null, 110])
  })

  it('fills every week of the range and counts weekdays Monday first', () => {
    const g = getGym(db, '4w')
    expect(g.bucket).toBe('week')
    expect(g.buckets.map((b) => [b.start, b.sessions, b.durationS / 60])).toEqual([
      ['2024-02-19', 2, 90],
      ['2024-02-26', 0, 0],
      ['2024-03-04', 1, 90],
      ['2024-03-11', 0, 0]
    ])
    // 20 Feb and 5 Mar 2024 are Tuesdays, 22 Feb a Thursday.
    expect(g.weekdays).toEqual([0, 2, 0, 1, 0, 0, 0])
  })

  it('switches to months on a long range and drops a token energy value', () => {
    const g = getGym(db, 'all')
    expect(g.summary.prevSessions).toBeNull()
    expect(g.bucket).toBe('month')
    expect(g.buckets[0]).toEqual({ start: '2022-06-01', sessions: 1, durationS: 6000 })
    expect(g.buckets[g.buckets.length - 1].start).toBe('2024-03-01')
    expect(g.sessions[0].energyKcal).toBeNull()
    expect(g.summary.energySessions).toBe(3)
    expect(g.summary.avgEnergyKcal).toBe(400)
  })

  it('returns an empty but well-formed result for a range without sessions', () => {
    process.env.FD_NOW = '2025-06-02'
    try {
      const g = getGym(db, '4w')
      expect(g.summary.sessions).toBe(0)
      expect(g.summary.avgDurationS).toBeNull()
      expect(g.summary.avgHr).toBeNull()
      expect(g.summary.longest).toBeNull()
      expect(g.buckets).toHaveLength(4)
      expect(g.table).toEqual([])
      expect(g.totalSessions).toBe(5)
      expect(g.lastSessionDate).toBe('2024-03-05')
    } finally {
      process.env.FD_NOW = '2024-03-15'
    }
  })
})
