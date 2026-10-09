// Timestamp helpers for Apple Health exports.
// Health writes '2024-01-31 18:05:09 +0100'; GPX files use ISO 8601 in UTC ('2024-01-31T17:05:09Z').

const DAY_S = 86_400

function d2(s: string, i: number): number {
  return (s.charCodeAt(i) - 48) * 10 + (s.charCodeAt(i + 1) - 48)
}

/** Days since 1970-01-01 of a proleptic Gregorian date. */
export function daysFromCivil(y: number, m: number, d: number): number {
  if (m <= 2) y -= 1
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146_097 + doe - 719_468
}

/** 'YYYY-MM-DD' of a day number (days since 1970-01-01). */
export function dateOfDayNumber(z: number): string {
  z += 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${String(y).padStart(4, '0')}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`
}

/**
 * UTC offset in minutes of a Health timestamp ('+0200' -> 120, '-0330' -> -210).
 * 0 when the string carries no offset; NaN when it is malformed.
 */
export function parseOffsetMin(s: string | undefined): number {
  if (!s || s.length < 21) return 0
  let i = 19
  while (i < s.length && s.charCodeAt(i) === 32) i++
  if (i >= s.length) return 0
  const c = s.charCodeAt(i)
  if (c === 90 /* Z */) return 0
  if (c !== 43 /* + */ && c !== 45 /* - */) return NaN
  if (i + 4 >= s.length) return NaN
  const hh = d2(s, i + 1)
  const mmAt = s.charCodeAt(i + 3) === 58 /* : */ ? i + 4 : i + 3
  const mm = mmAt + 1 < s.length ? d2(s, mmAt) : NaN
  if (!(hh >= 0 && hh <= 14 && mm >= 0 && mm <= 59)) return NaN
  return (c === 45 ? -1 : 1) * (hh * 60 + mm)
}

/**
 * Unix seconds of a Health timestamp ('2024-01-31 18:05:09 +0100'), NaN when malformed.
 * This runs about two million times per import, so it avoids Date and regular expressions.
 */
export function parseHealthTs(s: string | undefined): number {
  if (!s || s.length < 19) return NaN
  if (s.charCodeAt(4) !== 45 || s.charCodeAt(7) !== 45 || s.charCodeAt(13) !== 58 || s.charCodeAt(16) !== 58) return NaN
  const y = d2(s, 0) * 100 + d2(s, 2)
  const mo = d2(s, 5)
  const d = d2(s, 8)
  const h = d2(s, 11)
  const mi = d2(s, 14)
  const se = d2(s, 17)
  // Range checks double as digit checks: any non-digit pushes a component out of range.
  if (!(y >= 1900 && y <= 2200 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && se >= 0 && se <= 60)) {
    return NaN
  }
  const off = parseOffsetMin(s)
  return daysFromCivil(y, mo, d) * DAY_S + h * 3600 + mi * 60 + se - off * 60
}

export interface HealthTime {
  /** Unix seconds. */
  ts: number
  /** UTC offset written in the timestamp, in minutes. */
  offsetMin: number
}

export function parseHealthDate(s: string | undefined): HealthTime | null {
  const ts = parseHealthTs(s)
  if (Number.isNaN(ts)) return null
  return { ts, offsetMin: parseOffsetMin(s) }
}

/** Day number (days since 1970-01-01) of an instant in a zone `offsetMin` minutes east of UTC. */
export function localDayNumber(ts: number, offsetMin: number): number {
  return Math.floor((ts + offsetMin * 60) / DAY_S)
}

/** Local calendar date 'YYYY-MM-DD' of an instant in a zone `offsetMin` minutes east of UTC. */
export function localDate(ts: number, offsetMin: number): string {
  return dateOfDayNumber(localDayNumber(ts, offsetMin))
}

/** Unix seconds (with fraction) of an ISO 8601 timestamp as used in GPX files; NaN when malformed. */
export function parseIsoTs(s: string | undefined): number {
  if (!s) return NaN
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?\s*$/.exec(s)
  if (!m) return NaN
  let off = 0
  if (m[8] && m[8] !== 'Z') {
    const digits = m[8].replace(':', '')
    off = (digits[0] === '-' ? -1 : 1) * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)))
  }
  return (
    daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) * DAY_S +
    Number(m[4]) * 3600 +
    Number(m[5]) * 60 +
    Number(m[6]) +
    (m[7] ? Number(m[7]) : 0) -
    off * 60
  )
}
