// Unit conversion for HealthKit quantities. Every function returns null for a missing
// value or an unknown unit, so that nothing is ever converted by assumption.

function num(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Removes binary floating-point noise from a product (1234 * 0.01 -> 12.34, not 12.340000000000002). */
function tidy(n: number): number {
  return Number(n.toPrecision(12))
}

function convert(value: string | number | undefined | null, unit: string | undefined | null, table: Record<string, number>): number | null {
  const n = num(value)
  if (n === null || !unit) return null
  const factor = table[unit] ?? table[unit.toLowerCase()]
  return factor === undefined ? null : tidy(n * factor)
}

const LENGTH_M: Record<string, number> = {
  m: 1,
  km: 1000,
  cm: 0.01,
  mm: 0.001,
  mi: 1609.344,
  yd: 0.9144,
  ft: 0.3048,
  in: 0.0254
}

const DURATION_S: Record<string, number> = {
  s: 1,
  sec: 1,
  ms: 0.001,
  min: 60,
  hr: 3600,
  h: 3600,
  d: 86_400
}

// Health writes dietary and active energy as 'kcal' or 'Cal' (both kilocalories); 'cal' is the small calorie.
const ENERGY_KCAL: Record<string, number> = {
  kcal: 1,
  Cal: 1,
  cal: 0.001,
  kJ: 1 / 4.184,
  J: 1 / 4184
}

const RATE_PER_MIN: Record<string, number> = {
  'count/min': 1,
  'count/s': 60,
  bpm: 1
}

const MASS_KG: Record<string, number> = {
  kg: 1,
  g: 0.001,
  lb: 0.453_592_37,
  lbs: 0.453_592_37,
  oz: 0.028_349_523_125,
  st: 6.350_293_18
}

const POWER_W: Record<string, number> = {
  W: 1,
  kW: 1000
}

export function toMeters(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  return convert(value, unit, LENGTH_M)
}

export function toSeconds(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  return convert(value, unit, DURATION_S)
}

export function toMillis(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  const s = toSeconds(value, unit)
  return s === null ? null : tidy(s * 1000)
}

export function toCentimeters(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  const m = toMeters(value, unit)
  return m === null ? null : tidy(m * 100)
}

export function toKcal(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  const n = num(value)
  if (n === null || !unit) return null
  // Case matters here: 'Cal' is a kilocalorie, 'cal' is not.
  const factor = ENERGY_KCAL[unit]
  return factor === undefined ? null : tidy(n * factor)
}

/** Heart rate or breathing rate in events per minute. */
export function toPerMinute(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  return convert(value, unit, RATE_PER_MIN)
}

export function toKg(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  return convert(value, unit, MASS_KG)
}

export function toWatts(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  const n = num(value)
  if (n === null || !unit) return null
  const factor = POWER_W[unit]
  return factor === undefined ? null : tidy(n * factor)
}

/** Plain count (steps, effort score): the unit must be absent or a count. */
export function toCount(value: string | number | undefined | null, unit: string | undefined | null): number | null {
  const n = num(value)
  if (n === null) return null
  return !unit || unit === 'count' || unit === 'appleEffortScore' ? n : null
}

/** Splits a metadata quantity such as '1234 cm' or '68.5 degF' into number and unit. */
export function parseQuantity(text: string | undefined | null): { value: number; unit: string } | null {
  if (!text) return null
  const m = /^\s*(-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)\s*(\S.*?)?\s*$/.exec(text)
  if (!m) return null
  const value = Number(m[1].replace(',', '.'))
  return Number.isFinite(value) ? { value, unit: m[2] ?? '' } : null
}
