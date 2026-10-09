import type { Ymd } from './dates'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

function parts(s: Ymd): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d, dow: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 }
}

/** '8 Oct' */
export function fmtDayMonth(s: Ymd): string {
  const p = parts(s)
  return `${p.d} ${MON[p.m - 1]}`
}

/** 'Thu 8 Oct' */
export function fmtDateShort(s: Ymd): string {
  const p = parts(s)
  return `${DOW[p.dow]} ${p.d} ${MON[p.m - 1]}`
}

/** '8 Oct 2026' */
export function fmtDateYear(s: Ymd): string {
  const p = parts(s)
  return `${p.d} ${MON[p.m - 1]} ${p.y}`
}

/** 'Thursday 8 October 2026' */
export function fmtDateLong(s: Ymd): string {
  const p = parts(s)
  return `${DOW_LONG[p.dow]} ${p.d} ${MON_LONG[p.m - 1]} ${p.y}`
}

/** 'Oct' */
export function fmtMonth(s: Ymd): string {
  return MON[parts(s).m - 1]
}

/** Local wall-clock time 'HH:MM' from unix seconds plus the workout's UTC offset in minutes. */
export function fmtClock(ts: number, tzOffsetMin: number): string {
  const d = new Date((ts + tzOffsetMin * 60) * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** '48:10' or '2:05:00' */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** '6 h 22 min', '48 min' */
export function fmtHoursMin(seconds: number): string {
  const totalMin = Math.round(seconds / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

/** Seconds per kilometre, or null when either input is missing or zero. */
export function paceFrom(distanceM: number | null | undefined, durationS: number | null | undefined): number | null {
  if (!distanceM || !durationS || distanceM <= 0 || durationS <= 0) return null
  return durationS / (distanceM / 1000)
}

/** '5:07' (min:sec per km). Add the ' /km' unit at the call site. */
export function fmtPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '–'
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Metres to kilometres with fixed decimals: 9404 -> '9.4' */
export function fmtKm(metres: number | null | undefined, digits = 1): string {
  if (metres == null) return '–'
  return (metres / 1000).toFixed(digits)
}

/** Thousands separators and fixed decimals: 1948.2 -> '1,948' */
export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !isFinite(n)) return '–'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Signed percent change of `now` against `before`, or null when there is no baseline. */
export function pctChange(now: number, before: number): number | null {
  if (!before) return null
  return ((now - before) / before) * 100
}
