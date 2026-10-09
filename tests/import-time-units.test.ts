import { describe, expect, it } from 'vitest'
import { dateOfDayNumber, daysFromCivil, localDate, parseHealthDate, parseHealthTs, parseIsoTs, parseOffsetMin } from '../src/main/import/time'
import { parseQuantity, toCentimeters, toCount, toKcal, toKg, toMeters, toMillis, toPerMinute, toSeconds, toWatts } from '../src/main/import/units'

const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => Date.UTC(y, mo - 1, d, h, mi, s) / 1000

describe('Health timestamps', () => {
  it('parses the export format with its own offset', () => {
    expect(parseHealthTs('2024-01-31 18:05:09 +0100')).toBe(utc(2024, 1, 31, 17, 5, 9))
    expect(parseHealthTs('2024-07-01 00:00:00 +0200')).toBe(utc(2024, 6, 30, 22))
    expect(parseHealthTs('2024-01-31 18:05:09 -0330')).toBe(utc(2024, 1, 31, 21, 35, 9))
    expect(parseHealthDate('2024-01-31 18:05:09 -0330')).toEqual({ ts: utc(2024, 1, 31, 21, 35, 9), offsetMin: -210 })
  })

  it('accepts a colon in the offset, Z and a missing offset', () => {
    expect(parseOffsetMin('2024-01-31 18:05:09 +05:30')).toBe(330)
    expect(parseHealthTs('2024-01-31 18:05:09 +05:30')).toBe(utc(2024, 1, 31, 12, 35, 9))
    expect(parseHealthTs('2024-01-31 18:05:09 Z')).toBe(utc(2024, 1, 31, 18, 5, 9))
    expect(parseHealthTs('2024-01-31 18:05:09')).toBe(utc(2024, 1, 31, 18, 5, 9))
  })

  it('agrees with Date over leap years and century rules', () => {
    for (const [y, m, d] of [
      [1970, 1, 1],
      [2000, 2, 29],
      [2023, 12, 31],
      [2024, 2, 29],
      [2024, 3, 1],
      [2100, 3, 1]
    ]) {
      const stamp = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 12:00:00 +0000`
      expect(parseHealthTs(stamp)).toBe(utc(y, m, d, 12))
      expect(dateOfDayNumber(daysFromCivil(y, m, d))).toBe(stamp.slice(0, 10))
    }
  })

  it('returns NaN or null for anything else', () => {
    for (const bad of [undefined, '', 'yesterday', '2024-13-01 00:00:00 +0000', '2024-01-31 25:00:00 +0000', '2024/01/31 10:00:00 +0000', '2024-01-31 10:00:00 +01']) {
      expect(parseHealthTs(bad)).toBeNaN()
      expect(parseHealthDate(bad)).toBeNull()
    }
  })

  it('takes the local date from the offset, not from UTC', () => {
    const late = parseHealthDate('2024-01-31 23:30:00 -0500')!
    expect(localDate(late.ts, late.offsetMin)).toBe('2024-01-31')
    expect(localDate(late.ts, 0)).toBe('2024-02-01')
    const early = parseHealthDate('2024-03-01 00:15:00 +0200')!
    expect(localDate(early.ts, early.offsetMin)).toBe('2024-03-01')
    expect(localDate(early.ts, 0)).toBe('2024-02-29')
  })

  it('parses the ISO timestamps of GPX files', () => {
    expect(parseIsoTs('2024-01-31T17:05:09Z')).toBe(utc(2024, 1, 31, 17, 5, 9))
    expect(parseIsoTs('2024-01-31T17:05:09.500Z')).toBe(utc(2024, 1, 31, 17, 5, 9) + 0.5)
    expect(parseIsoTs('2024-01-31T18:05:09+01:00')).toBe(utc(2024, 1, 31, 17, 5, 9))
    expect(parseIsoTs('17:05')).toBeNaN()
  })
})

describe('unit conversion', () => {
  it('converts lengths by unit', () => {
    expect(toMeters('6.5', 'km')).toBe(6500)
    expect(toMeters('450', 'm')).toBe(450)
    expect(toMeters('1234', 'cm')).toBe(12.34)
    expect(toMeters('1', 'mi')).toBeCloseTo(1609.344, 6)
    expect(toMeters('100', 'yd')).toBeCloseTo(91.44, 6)
  })

  it('converts durations, energy, rates, mass and power', () => {
    expect(toSeconds('1.5', 'min')).toBe(90)
    expect(toSeconds('250', 'ms')).toBe(0.25)
    expect(toSeconds('2', 'hr')).toBe(7200)
    // no binary noise such as 280.00000000000006
    expect(toMillis('280', 'ms')).toBe(280)
    expect(toMillis('0.28', 's')).toBe(280)
    expect(toCentimeters('9.5', 'cm')).toBe(9.5)
    expect(toCentimeters('0.095', 'm')).toBe(9.5)
    expect(toKcal('300', 'kcal')).toBe(300)
    expect(toKcal('300', 'Cal')).toBe(300)
    expect(toKcal('4184', 'kJ')).toBeCloseTo(1000, 6)
    expect(toPerMinute('150', 'count/min')).toBe(150)
    expect(toPerMinute('2.5', 'count/s')).toBe(150)
    expect(toKg('176.37', 'lb')).toBeCloseTo(80, 2)
    expect(toKg('80', 'kg')).toBe(80)
    expect(toWatts('0.2', 'kW')).toBeCloseTo(200, 10)
    expect(toCount('8000', 'count')).toBe(8000)
    expect(toCount('4', 'appleEffortScore')).toBe(4)
  })

  it('never guesses: unknown units and missing values give null', () => {
    expect(toMeters('5', 'furlong')).toBeNull()
    expect(toMeters('5', undefined)).toBeNull()
    expect(toMeters(undefined, 'km')).toBeNull()
    expect(toMeters('', 'km')).toBeNull()
    expect(toMeters('abc', 'km')).toBeNull()
    expect(toSeconds('5', 'km')).toBeNull()
    expect(toKcal('5', 'cal')).toBeCloseTo(0.005, 10)
    expect(toKcal('5', 'kg')).toBeNull()
    expect(toPerMinute('5', 'count')).toBeNull()
    expect(toWatts('5', 'kcal')).toBeNull()
    expect(toCount('5', 'km')).toBeNull()
  })

  it('splits metadata quantities into number and unit', () => {
    expect(parseQuantity('1234 cm')).toEqual({ value: 1234, unit: 'cm' })
    expect(parseQuantity('68.5 degF')).toEqual({ value: 68.5, unit: 'degF' })
    expect(parseQuantity('25 m')).toEqual({ value: 25, unit: 'm' })
    expect(parseQuantity('12')).toEqual({ value: 12, unit: '' })
    expect(parseQuantity('high')).toBeNull()
    expect(parseQuantity(undefined)).toBeNull()
  })
})
