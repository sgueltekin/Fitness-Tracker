// getOverview against an in-memory database filled with made-up workouts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db'
import { getOverview } from '../src/main/queries/overview'
import type { Category, Sport } from '../src/shared/domain'

/** A Wednesday; its week starts on Monday 2025-03-10. */
const TODAY = '2025-03-12'

interface Seed {
  date: string
  sport?: Sport
  category?: Category
  minutes?: number
  km?: number | null
  effort?: number | null
  hr?: number | null
}

let db: Db
let seq = 0
let savedNow: string | undefined

function add(w: Seed): string {
  const sport = w.sport ?? 'run'
  const uid = `test-${++seq}`
  const start = Date.parse(`${w.date}T10:00:00Z`) / 1000 + seq
  const duration = (w.minutes ?? 30) * 60
  const km = w.km === undefined ? (sport === 'run' ? 5 : null) : w.km
  db.prepare(
    `INSERT INTO workouts (uid, sport, activity_type, category, source, start_ts, end_ts, tz_offset_min, local_date,
                           duration_s, distance_m, avg_hr, effort)
     VALUES (?, ?, 'Test', ?, 'Test', ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(uid, sport, w.category ?? (sport === 'run' ? 'easy' : sport), start, start + duration, w.date, duration, km == null ? null : km * 1000, w.hr ?? null, w.effort ?? null)
  return uid
}

beforeAll(() => {
  savedNow = process.env.FD_NOW
  process.env.FD_NOW = TODAY
})

afterAll(() => {
  if (savedNow === undefined) delete process.env.FD_NOW
  else process.env.FD_NOW = savedNow
})

beforeEach(() => {
  db = openDatabase(':memory:')
  seq = 0
})

describe('getOverview buckets', () => {
  it('returns every week of the range, oldest first, and marks the current one', () => {
    add({ date: '2025-03-11' })
    const d = getOverview(db, '12w')
    expect(d.unit).toBe('week')
    expect(d.buckets).toHaveLength(12)
    expect(d.buckets[0].start).toBe('2024-12-23')
    expect(d.buckets[11]).toMatchObject({ start: '2025-03-10', current: true, sessions: 1 })
    expect(d.buckets.filter((b) => b.current)).toHaveLength(1)
    expect(d.buckets[10]).toMatchObject({ sessions: 0, seconds: {}, runDistanceM: 0 })
  })

  it('stacks time by training category and counts other sports under other', () => {
    add({ date: '2025-03-10', category: 'long', minutes: 60 })
    add({ date: '2025-03-10', sport: 'strength', minutes: 45 })
    add({ date: '2025-03-11', sport: 'swim', minutes: 20 })
    add({ date: '2025-03-11', category: 'other', minutes: 10 })
    const d = getOverview(db, '4w')
    const week = d.buckets[d.buckets.length - 1]
    expect(week.seconds).toEqual({ long: 3600, strength: 2700, other: 1800 })
    expect(week).toMatchObject({ sessions: 4, runs: 2, gymSessions: 1 })
    expect(d.mix.map((m) => m.category)).toEqual(['long', 'strength', 'other'])
    expect(d.mix.find((m) => m.category === 'other')).toMatchObject({ seconds: 1800, sessions: 2 })
    // The calendar keeps the recorded session types.
    expect(d.calendar.days.find((x) => x.date === '2025-03-11')?.categories).toEqual(['swim', 'other'])
  })

  it('uses the category after a manual override', () => {
    const uid = add({ date: '2025-03-10', category: 'other', minutes: 40 })
    db.prepare('INSERT INTO workout_overrides (uid, category) VALUES (?, ?)').run(uid, 'tempo')
    const d = getOverview(db, '4w')
    expect(d.buckets[3].seconds).toEqual({ tempo: 2400 })
  })

  it('reports distance as null when runs exist but none recorded one', () => {
    add({ date: '2025-03-03', km: null })
    add({ date: '2025-03-10', km: null })
    add({ date: '2025-03-11', km: 4 })
    const d = getOverview(db, '4w')
    expect(d.buckets[2]).toMatchObject({ runs: 1, runDistanceM: null })
    expect(d.buckets[3]).toMatchObject({ runs: 2, runDistanceM: 4000 })
    expect(d.buckets[1]).toMatchObject({ runs: 0, runDistanceM: 0 })
  })

  it('switches to months and caps the calendar when the range is longer than a year', () => {
    add({ date: '2023-01-18', sport: 'strength', minutes: 50 })
    add({ date: '2025-03-01' })
    const d = getOverview(db, 'all')
    expect(d.unit).toBe('month')
    expect(d.buckets[0].start).toBe('2023-01-01')
    expect(d.buckets).toHaveLength(27)
    expect(d.buckets[26]).toMatchObject({ start: '2025-03-01', current: true, sessions: 1 })
    expect(d.buckets[0]).toMatchObject({ sessions: 1, gymSessions: 1 })
    expect(d.calendar).toMatchObject({ weeks: 53, capped: true, from: '2024-03-11' })
    expect(d.calendar.days.map((x) => x.date)).toEqual(['2025-03-01'])
    expect(d.mix.reduce((s, m) => s + m.sessions, 0)).toBe(2)
  })
})

describe('getOverview load', () => {
  it('is effort times minutes, and tells missing ratings from weeks without training', () => {
    add({ date: '2025-02-18', minutes: 30 }) // unrated, before any rating
    add({ date: '2025-02-26', minutes: 40, effort: 5 })
    add({ date: '2025-02-27', sport: 'strength', minutes: 60, effort: 6 })
    add({ date: '2025-02-28', minutes: 20 }) // unrated run in a rated week
    add({ date: '2025-03-11', minutes: 30 }) // only an unrated run this week
    const d = getOverview(db, '4w')
    expect(d.effortSince).toBe('2025-02-26')
    const [w1, w2, w3, w4] = d.buckets
    expect(w1.load).toBeNull()
    expect(w2).toMatchObject({ load: 560, loadRun: 200, loadGym: 360, ratedSessions: 2, sessions: 3 })
    expect(w3).toMatchObject({ load: 0, sessions: 0 })
    expect(w4).toMatchObject({ load: null, sessions: 1, ratedSessions: 0 })
  })

  it('is null everywhere when nothing was ever rated', () => {
    add({ date: '2025-03-04' })
    const d = getOverview(db, '4w')
    expect(d.effortSince).toBeNull()
    expect(d.buckets.every((b) => b.load === null)).toBe(true)
  })
})

describe('getOverview 7-day windows', () => {
  it('anchors the windows on today and reaches back before the range when needed', () => {
    add({ date: '2025-03-12', km: 6, minutes: 35 })
    add({ date: '2025-03-06', sport: 'strength', minutes: 50 })
    add({ date: '2025-03-05', km: 3 }) // 7 days ago: previous window
    add({ date: '2025-02-14', km: 8 }) // before the 4-week range, inside the oldest window
    const d = getOverview(db, '4w')
    expect(d.range.from).toBe('2025-02-17')
    expect(d.windows).toHaveLength(4)
    expect(d.windows[3]).toEqual({ from: '2025-03-06', to: '2025-03-12', runDistanceM: 6000, trainingS: 5100, runs: 1, gymSessions: 1 })
    expect(d.windows[2]).toMatchObject({ from: '2025-02-27', to: '2025-03-05', runs: 1, runDistanceM: 3000 })
    expect(d.windows[0]).toMatchObject({ from: '2025-02-13', runs: 1, runDistanceM: 8000 })
    // The range itself does not include that early run.
    expect(d.buckets.reduce((s, b) => s + b.runs, 0)).toBe(2)
  })

  it('never returns more than twelve windows, and always two', () => {
    add({ date: '2025-03-12' })
    expect(getOverview(db, '1y').windows).toHaveLength(12)
    expect(getOverview(db, 'all').windows).toHaveLength(2)
  })
})

describe('getOverview gym and recent', () => {
  it('averages heart rate over the sessions that have one', () => {
    add({ date: '2025-03-03', sport: 'strength', minutes: 40, hr: 100 })
    add({ date: '2025-03-04', sport: 'strength', minutes: 60, hr: 120 })
    add({ date: '2025-03-05', sport: 'strength', minutes: 50 })
    const d = getOverview(db, '4w')
    expect(d.gym).toEqual({ sessions: 3, avgDurationS: 3000, avgHr: 110, hrSessions: 2 })
  })

  it('has no gym averages without sessions, and lists the latest workouts newest first', () => {
    for (let i = 0; i < 10; i++) add({ date: `2024-11-${String(i + 1).padStart(2, '0')}` })
    const d = getOverview(db, '4w')
    expect(d.gym).toEqual({ sessions: 0, avgDurationS: null, avgHr: null, hrSessions: 0 })
    expect(d.mix).toEqual([])
    expect(d.recent).toHaveLength(8)
    expect(d.recent[0].date).toBe('2024-11-10')
    expect(d.recent[7].date).toBe('2024-11-03')
  })
})
