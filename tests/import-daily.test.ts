import { describe, expect, it } from 'vitest'
import { SOURCE_SLOTS } from '../src/main/import/collect'
import { attributeSleep, largestSourcePerDay } from '../src/main/import/daily'
import { parseHealthDate } from '../src/main/import/time'
import type { SleepSegment, SleepStage } from '../src/main/import/types'

/** An asleep interval given as local wall-clock times. */
function seg(start: string, end: string, stage: SleepStage = 'core', source = 'Test Watch', offset = '+0100'): SleepSegment {
  const s = parseHealthDate(`${start}:00 ${offset}`)!
  const e = parseHealthDate(`${end}:00 ${offset}`)!
  return { startTs: s.ts, endTs: e.ts, tzOffsetMin: e.offsetMin, stage, source }
}

describe('sleep attribution', () => {
  it('counts a night for the date it ends on and sums the stages', () => {
    const nights = attributeSleep([
      seg('2024-03-01 23:00', '2024-03-02 01:00', 'core'),
      seg('2024-03-02 01:00', '2024-03-02 02:00', 'deep'),
      // ten minutes awake are simply not in the input
      seg('2024-03-02 02:10', '2024-03-02 04:00', 'rem'),
      seg('2024-03-02 04:00', '2024-03-02 06:30', 'core')
    ])
    expect(nights).toHaveLength(1)
    expect(nights[0].date).toBe('2024-03-02')
    expect(nights[0].hours).toBeCloseTo(7 + 20 / 60, 6)
    expect(nights[0].deepHours).toBeCloseTo(1, 6)
    expect(nights[0].remHours).toBeCloseTo(11 / 6, 6)
    expect(nights[0].coreHours).toBeCloseTo(4.5, 6)
  })

  it('keeps consecutive nights apart and adds an afternoon nap to its own day', () => {
    const nights = attributeSleep([
      seg('2024-03-01 23:30', '2024-03-02 07:00'),
      seg('2024-03-02 14:00', '2024-03-02 14:45'),
      seg('2024-03-02 22:45', '2024-03-03 06:15')
    ])
    expect(nights.map((n) => [n.date, n.hours])).toEqual([
      ['2024-03-02', 8.25],
      ['2024-03-03', 7.5]
    ])
  })

  it('goes by the local time of the end, using the offset of the timestamp', () => {
    // 20:00 to 23:30 at UTC+1 ends on the 5th although it is long past midnight further east
    const [night] = attributeSleep([seg('2024-03-05 20:00', '2024-03-05 23:30')])
    expect(night.date).toBe('2024-03-05')
    const [far] = attributeSleep([seg('2024-03-05 20:00', '2024-03-06 00:30', 'core', 'Test Watch', '+1000')])
    expect(far.date).toBe('2024-03-06')
  })

  it('uses one source per night and prefers the watch', () => {
    const nights = attributeSleep([
      seg('2024-03-01 22:00', '2024-03-02 07:00', 'unspecified', 'Test Phone'),
      seg('2024-03-01 23:00', '2024-03-02 03:00', 'core', 'Test Watch'),
      seg('2024-03-02 03:00', '2024-03-02 06:00', 'deep', 'Test Watch'),
      // the next night only the phone recorded
      seg('2024-03-02 23:00', '2024-03-03 06:00', 'unspecified', 'Test Phone')
    ])
    expect(nights).toEqual([
      { date: '2024-03-02', source: 'Test Watch', hours: 7, deepHours: 3, remHours: 0, coreHours: 4 },
      { date: '2024-03-03', source: 'Test Phone', hours: 7, deepHours: null, remHours: null, coreHours: null }
    ])
  })

  it('takes the source with more sleep when neither is a watch', () => {
    const [night] = attributeSleep([
      seg('2024-03-01 23:00', '2024-03-02 05:00', 'unspecified', 'App A'),
      seg('2024-03-01 23:00', '2024-03-02 06:30', 'unspecified', 'App B')
    ])
    expect(night).toMatchObject({ source: 'App B', hours: 7.5 })
  })

  it('does not count overlapping intervals of one source twice', () => {
    const [night] = attributeSleep([
      seg('2024-03-01 23:00', '2024-03-02 03:00', 'core'),
      seg('2024-03-02 02:00', '2024-03-02 05:00', 'rem'),
      seg('2024-03-02 02:30', '2024-03-02 04:00', 'deep')
    ])
    expect(night.hours).toBe(6)
    expect(night.coreHours).toBe(4)
    expect(night.remHours).toBe(2)
    expect(night.deepHours).toBe(0)
  })

  it('returns nothing for no input', () => {
    expect(attributeSleep([])).toEqual([])
  })
})

describe('steps per day', () => {
  it('takes the largest single source instead of adding phone and watch', () => {
    const day = 19_800
    const byDaySource = new Map<number, number>([
      [day * SOURCE_SLOTS + 0, 4000 + 3000], // phone
      [day * SOURCE_SLOTS + 1, 6500], // watch
      [(day + 1) * SOURCE_SLOTS + 1, 9000],
      [(day + 1) * SOURCE_SLOTS + 0, 1200]
    ])
    expect([...largestSourcePerDay(byDaySource)]).toEqual([
      [day, 7000],
      [day + 1, 9000]
    ])
  })
})
