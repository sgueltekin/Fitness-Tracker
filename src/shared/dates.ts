// Calendar dates are plain 'YYYY-MM-DD' strings in the user's local time.
// All arithmetic runs on UTC midnights so daylight-saving shifts cannot move a date.

export type Ymd = string

const DAY_MS = 86_400_000

function toUtc(s: Ymd): number {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): Ymd {
  const d = new Date(ms)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mm}-${dd}`
}

/** Local calendar date of a JS Date. */
export function ymd(d: Date): Ymd {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Today in local time. Set FD_NOW=YYYY-MM-DD to pin it (tests, screenshots). */
export function todayYmd(): Ymd {
  const pinned = typeof process !== 'undefined' ? process.env?.FD_NOW : undefined
  return pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? pinned : ymd(new Date())
}

export function addDays(s: Ymd, n: number): Ymd {
  return fromUtc(toUtc(s) + n * DAY_MS)
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a: Ymd, b: Ymd): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS)
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(s: Ymd): number {
  return (new Date(toUtc(s)).getUTCDay() + 6) % 7
}

/** Weeks start on Monday. */
export function mondayOf(s: Ymd): Ymd {
  return addDays(s, -weekdayIndex(s))
}

/** Every Monday from the week containing `from` to the week containing `to`. */
export function weekStartsBetween(from: Ymd, to: Ymd): Ymd[] {
  const out: Ymd[] = []
  const last = mondayOf(to)
  for (let w = mondayOf(from); w <= last; w = addDays(w, 7)) out.push(w)
  return out
}

/** Every date from `from` to `to`, inclusive. */
export function daysBetween(from: Ymd, to: Ymd): Ymd[] {
  const out: Ymd[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

export type RangeKey = '4w' | '12w' | '6m' | '1y' | 'all'

export const RANGE_OPTIONS: { key: RangeKey; label: string; weeks: number | null }[] = [
  { key: '4w', label: '4 weeks', weeks: 4 },
  { key: '12w', label: '12 weeks', weeks: 12 },
  { key: '6m', label: '6 months', weeks: 26 },
  { key: '1y', label: '1 year', weeks: 52 },
  { key: 'all', label: 'All time', weeks: null }
]

export interface RangeBounds {
  /** Monday of the first week in the range. */
  from: Ymd
  /** Today. */
  to: Ymd
  /** Number of calendar weeks covered, including the current partial week. */
  weeks: number
}

/**
 * Ranges are whole Monday-based weeks ending with the current week.
 * `earliest` is the first date with data and bounds the 'all' range.
 */
export function rangeBounds(range: RangeKey, today: Ymd, earliest?: Ymd | null): RangeBounds {
  const thisMonday = mondayOf(today)
  const opt = RANGE_OPTIONS.find((o) => o.key === range)
  if (opt?.weeks) {
    return { from: addDays(thisMonday, -7 * (opt.weeks - 1)), to: today, weeks: opt.weeks }
  }
  const from = mondayOf(earliest && earliest < today ? earliest : today)
  return { from, to: today, weeks: diffDays(from, thisMonday) / 7 + 1 }
}
