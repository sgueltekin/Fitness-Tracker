import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays, daysBetween } from '../src/shared/dates'
import { openDatabase, type Db } from '../src/main/db'
import { buildSeries, buildSleepSeries, getHealth, sleepStages, summarize, type Night, type Point } from '../src/main/queries/health'

// All values here are invented.

/** One value per day from `from`, in order. */
function run(from: string, values: number[]): Point[] {
  return values.map((value, i) => ({ date: addDays(from, i), value }))
}

describe('summarize', () => {
  it('compares the last 7 days of a daily metric with its first 7', () => {
    const points = run('2024-03-01', [60, 60, 60, 60, 60, 60, 60, 99, 99, 50, 50, 50, 50, 50, 50, 50])
    const s = summarize(points, true, points[points.length - 1])
    expect(s.count).toBe(16)
    expect(s.current).toBe(50)
    expect(s.currentSpan).toEqual({ from: '2024-03-10', to: '2024-03-16' })
    expect(s.baseline).toBe(60)
    expect(s.baselineSpan).toEqual({ from: '2024-03-01', to: '2024-03-07' })
  })

  it('gives no baseline while the two weeks would overlap', () => {
    const points = run('2024-03-01', [60, 61, 62, 63, 64, 65, 66, 67, 68, 69])
    const s = summarize(points, true, null)
    expect(s.current).toBe(66)
    expect(s.currentSpan).toEqual({ from: '2024-03-04', to: '2024-03-10' })
    expect(s.baseline).toBeNull()
    expect(s.baselineSpan).toBeNull()
  })

  it('anchors the current week on the latest value, not on today', () => {
    const points: Point[] = [...run('2024-01-01', [40, 40, 40, 40, 40, 40, 40]), { date: '2024-02-10', value: 48 }, { date: '2024-02-12', value: 52 }]
    const s = summarize(points, true, null)
    expect(s.current).toBe(50)
    expect(s.currentSpan).toEqual({ from: '2024-02-06', to: '2024-02-12' })
    expect(s.baseline).toBe(40)
  })

  it('compares the latest reading of an occasional metric with the first', () => {
    const s = summarize(
      [
        { date: '2024-01-03', value: 80 },
        { date: '2024-02-01', value: 79 },
        { date: '2024-03-09', value: 78.5 }
      ],
      false,
      null
    )
    expect(s.current).toBe(78.5)
    expect(s.currentSpan).toEqual({ from: '2024-03-09', to: '2024-03-09' })
    expect(s.baseline).toBe(80)
    expect(s.baselineSpan).toEqual({ from: '2024-01-03', to: '2024-01-03' })
  })

  it('has no baseline for a single reading and keeps the last known value for an empty range', () => {
    expect(summarize([{ date: '2024-01-03', value: 80 }], false, null).baseline).toBeNull()
    const last = { date: '2021-05-05', value: 77 }
    expect(summarize([], false, last)).toEqual({ count: 0, current: null, currentSpan: null, baseline: null, baselineSpan: null, last })
  })
})

describe('buildSeries', () => {
  it('starts at the first value inside the range and runs to the end date', () => {
    const s = buildSeries(
      [
        { date: '2024-03-04', value: 70 },
        { date: '2024-03-06', value: 72 }
      ],
      '2024-02-01',
      '2024-03-08',
      false
    )
    expect(s.dates).toEqual(daysBetween('2024-03-04', '2024-03-08'))
    expect(s.values).toEqual([70, null, 72, null, null])
    expect(s.avg7).toBeNull()
  })

  it('is empty when the range holds no value', () => {
    expect(buildSeries([{ date: '2023-01-01', value: 1 }], '2024-02-01', '2024-03-08', true)).toEqual({ dates: [], values: [], avg7: [] })
  })

  it('needs four days for a 7-day mean and uses values from just before the range', () => {
    const fresh = buildSeries(run('2024-03-01', [10, 20, 30, 40, 50]), '2024-03-01', '2024-03-05', true)
    expect(fresh.avg7).toEqual([null, null, null, 25, 30])

    const withLeadIn = buildSeries(run('2024-02-27', [10, 10, 10, 10, 20]), '2024-03-02', '2024-03-02', true)
    expect(withLeadIn.dates).toEqual(['2024-03-02'])
    expect(withLeadIn.avg7).toEqual([12])
  })

  it('lets the mean run out a few days after the data stops', () => {
    const s = buildSeries(run('2024-03-01', [8, 8, 8, 8, 8, 8, 8]), '2024-03-01', '2024-03-12', true)
    // From 11 March the trailing week holds only 3 values.
    expect(s.avg7?.slice(-3)).toEqual([8, null, null])
  })
})

describe('sleep', () => {
  const night = (date: string, total: number, deep: number | null = null, core: number | null = null, rem: number | null = null): Night => ({
    date,
    total,
    deep,
    core,
    rem
  })

  it('draws single nights on a short span, leaving nights without data empty', () => {
    const s = buildSleepSeries([night('2024-03-01', 7, 1, 4, 2), night('2024-03-03', 8)], '2024-03-04')
    expect(s.bucket).toBe('night')
    expect(s.starts).toEqual(['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04'])
    expect(s.total).toEqual([7, null, 8, null])
    expect(s.deep).toEqual([1, null, null, null])
    expect(s.nights).toEqual([1, 0, 1, 0])
  })

  it('averages per week on a long span, stages only over the nights that have them', () => {
    const s = buildSleepSeries(
      [night('2024-01-01', 6, 1, 3, 2), night('2024-01-03', 8), night('2024-01-04', 7, 2, 3, 2), night('2024-06-10', 9, 1, 6, 2)],
      '2024-06-12'
    )
    expect(s.bucket).toBe('week')
    expect(s.starts[0]).toBe('2024-01-01')
    expect(s.starts[s.starts.length - 1]).toBe('2024-06-10')
    expect(s.total[0]).toBe(7)
    expect(s.deep[0]).toBe(1.5)
    expect(s.nights[0]).toBe(3)
    expect(s.total[1]).toBeNull()
    expect(s.total[s.total.length - 1]).toBe(9)
  })

  it('switches to months past about two years', () => {
    const s = buildSleepSeries([night('2021-01-15', 7), night('2024-06-10', 9)], '2024-06-12')
    expect(s.bucket).toBe('month')
    expect(s.starts[0]).toBe('2021-01-01')
    expect(s.starts[s.starts.length - 1]).toBe('2024-06-01')
  })

  it('takes the average night from staged nights only', () => {
    expect(sleepStages([night('2024-03-01', 8)])).toBeNull()
    expect(sleepStages([night('2024-03-01', 6, 1, 3, 2), night('2024-03-02', 10), night('2024-03-03', 8, 2, 4, 2)])).toEqual({
      nights: 2,
      totalHours: 7,
      deepHours: 1.5,
      coreHours: 3.5,
      remHours: 2
    })
  })
})

describe('getHealth', () => {
  let db: Db
  const savedNow = process.env.FD_NOW

  beforeAll(() => {
    process.env.FD_NOW = '2024-03-15'
    db = openDatabase(':memory:')
    const add = db.prepare('INSERT INTO daily_metrics (date, metric, value) VALUES (?, ?, ?)')
    // Resting heart rate every day from 20 Feb: 60 for a week, then 54.
    daysBetween('2024-02-20', '2024-03-15').forEach((d, i) => add.run(d, 'resting_hr', i < 7 ? 60 : 54))
    // Weight: one old reading and nothing since.
    add.run('2021-05-05', 'weight_kg', 77)
    // VO2 max: two readings in the range.
    add.run('2024-02-25', 'vo2max', 40)
    add.run('2024-03-10', 'vo2max', 41.5)
    // One staged night and one without stages.
    for (const [m, v] of [['sleep_hours', 8], ['sleep_deep_hours', 1], ['sleep_core_hours', 5], ['sleep_rem_hours', 2]] as const) {
      add.run('2024-03-14', m, v)
    }
    add.run('2024-03-15', 'sleep_hours', 6)
  })

  afterAll(() => {
    db.close()
    if (savedNow === undefined) delete process.env.FD_NOW
    else process.env.FD_NOW = savedNow
  })

  it('summarises each metric inside the range', () => {
    // No workouts in this database, so every range starts on the Monday of its first week.
    const h = getHealth(db, '12w')
    expect(h.hasData).toBe(true)
    expect(h.range.to).toBe('2024-03-15')

    expect(h.restingHr.summary.current).toBe(54)
    expect(h.restingHr.summary.baseline).toBe(60)
    expect(h.restingHr.series.dates[0]).toBe('2024-02-20')
    expect(h.restingHr.series.dates).toHaveLength(25)
    expect(h.restingHr.series.avg7?.[2]).toBeNull()
    expect(h.restingHr.series.avg7?.[3]).toBe(60)

    expect(h.vo2max.summary.current).toBe(41.5)
    expect(h.vo2max.summary.baseline).toBe(40)
    expect(h.vo2max.series.avg7).toBeNull()
  })

  it('reports a metric without a value in the range as empty, with its last known value', () => {
    const h = getHealth(db, '12w')
    expect(h.weight.summary.current).toBeNull()
    expect(h.weight.summary.count).toBe(0)
    expect(h.weight.summary.last).toEqual({ date: '2021-05-05', value: 77 })
    expect(h.weight.series.dates).toEqual([])

    expect(h.hrv.summary.last).toBeNull()
    expect(h.hrv.series.dates).toEqual([])
  })

  it('reads sleep nights with and without stages', () => {
    const h = getHealth(db, '4w')
    expect(h.sleep.series.bucket).toBe('night')
    expect(h.sleep.series.starts).toEqual(['2024-03-14', '2024-03-15'])
    expect(h.sleep.series.total).toEqual([8, 6])
    expect(h.sleep.series.deep).toEqual([1, null])
    expect(h.sleep.stages).toEqual({ nights: 1, totalHours: 8, deepHours: 1, coreHours: 5, remHours: 2 })
    expect(h.sleep.summary.current).toBe(7)
    expect(h.sleep.summary.baseline).toBeNull()
    expect(h.sleep.shortest).toEqual({ date: '2024-03-15', hours: 6 })
    expect(h.sleep.longest).toEqual({ date: '2024-03-14', hours: 8 })
  })

  it('says so when the database holds none of the metrics', () => {
    const empty = openDatabase(':memory:')
    try {
      const h = getHealth(empty, '12w')
      expect(h.hasData).toBe(false)
      expect(h.restingHr.summary.current).toBeNull()
      expect(h.sleep.series.starts).toEqual([])
      expect(h.sleep.stages).toBeNull()
    } finally {
      empty.close()
    }
  })
})
