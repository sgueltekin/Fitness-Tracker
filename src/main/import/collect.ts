// Collects what the importer needs from the stream of XML elements, in compact form:
// samples go into flat Float64Array tables, daily metrics are aggregated on the fly,
// and only workouts and sleep intervals are kept as objects.
import { sportFromActivityType } from '@shared/domain'
import { localDayNumber, parseHealthTs, parseOffsetMin } from './time'
import type { HrZone, RawWorkout, SleepSegment, SleepStage, WorkoutEvent, WorkoutEventType } from './types'
import { parseQuantity, toCentimeters, toCount, toKcal, toKg, toMeters, toMillis, toPerMinute, toSeconds, toWatts } from './units'
import type { HealthXmlHandler, XmlAttrs } from './xml'

/** Growable table of float64 rows, sortable by its first column. */
export class NumTable {
  private data: Float64Array
  length = 0

  constructor(
    readonly cols: number,
    capacity = 1024
  ) {
    this.data = new Float64Array(cols * capacity)
  }

  push(a: number, b = 0, c = 0, d = 0): void {
    const at = this.length * this.cols
    if (at + this.cols > this.data.length) {
      const grown = new Float64Array(this.data.length * 2)
      grown.set(this.data)
      this.data = grown
    }
    const v = this.data
    v[at] = a
    if (this.cols > 1) v[at + 1] = b
    if (this.cols > 2) v[at + 2] = c
    if (this.cols > 3) v[at + 3] = d
    this.length++
  }

  get(row: number, col: number): number {
    return this.data[row * this.cols + col]
  }

  /** Sorts rows by the first column; rows with equal keys keep their order. */
  sort(): void {
    const { cols, length } = this
    const src = this.data
    let sorted = true
    for (let i = 1; i < length; i++) {
      if (src[i * cols] < src[(i - 1) * cols]) {
        sorted = false
        break
      }
    }
    if (sorted) return
    const order = new Uint32Array(length)
    for (let i = 0; i < length; i++) order[i] = i
    order.sort((x, y) => src[x * cols] - src[y * cols] || x - y)
    const out = new Float64Array(length * cols)
    for (let i = 0; i < length; i++) {
      const from = order[i] * cols
      for (let c = 0; c < cols; c++) out[i * cols + c] = src[from + c]
    }
    this.data = out
  }

  /** First row whose first column is >= value. The table must be sorted. */
  lowerBound(value: number): number {
    let lo = 0
    let hi = this.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.data[mid * this.cols] < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}

/** Per-day mean. Map value: [sum, count]. */
type MeanAcc = Map<number, [number, number]>
/** Per-day latest value. Map value: [ts, value]. */
type LastAcc = Map<number, [number, number]>

export type MeanMetric = 'resting_hr' | 'hrv_sdnn' | 'respiratory_rate' | 'walking_hr_avg' | 'hr_recovery_1min'
export type LastMetric = 'vo2max' | 'weight_kg'

/** Room for this many distinct sources in a combined (day, source) map key. */
export const SOURCE_SLOTS = 65_536

const SLEEP_STAGES: Record<string, SleepStage> = {
  HKCategoryValueSleepAnalysisAsleepCore: 'core',
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'rem',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'unspecified',
  HKCategoryValueSleepAnalysisAsleep: 'unspecified'
}

const EVENT_TYPES: Record<string, WorkoutEventType> = {
  HKWorkoutEventTypeLap: 'Lap',
  HKWorkoutEventTypeSegment: 'Segment',
  HKWorkoutEventTypePause: 'Pause',
  HKWorkoutEventTypeResume: 'Resume',
  HKWorkoutEventTypeMotionPaused: 'MotionPaused',
  HKWorkoutEventTypeMotionResumed: 'MotionResumed',
  HKWorkoutEventTypeMarker: 'Marker'
}

const QTY = 'HKQuantityTypeIdentifier'

/** Removes the non-breaking and ordinary spaces Health leaves around device names. */
export function cleanSourceName(raw: string | undefined): string {
  return (raw ?? '').replace(/ /g, ' ').trim()
}

interface OpenWorkout {
  w: RawWorkout
  distances: Map<string, number>
  totalDistanceM: number | null
  totalEnergyKcal: number | null
  estimatedEffort: number | null
  zoneUnit: string | null
  inHrZoneGroup: boolean
}

export class HealthCollector implements HealthXmlHandler {
  exportDate: string | null = null
  recordCount = 0
  workouts: RawWorkout[] = []

  /** Source names exactly as written; a table's source column indexes into this. */
  sources: string[] = []
  private sourceIds = new Map<string, number>()

  /** [ts, bpm, source] */
  hr = new NumTable(3, 65_536)
  /** [ts, watts, source] */
  power = new NumTable(3, 32_768)
  /** [start, end, metres, source] */
  distWalkRun = new NumTable(4, 262_144)
  distSwim = new NumTable(4, 256)
  distCycle = new NumTable(4, 256)

  sleep: SleepSegment[] = []

  /** key: day number * SOURCE_SLOTS + source id */
  stepsByDaySource = new Map<number, number>()
  activeKcalByDaySource = new Map<number, number>()
  /** date -> kcal from <ActivitySummary> */
  activitySummaryKcal = new Map<string, number>()

  means: Record<MeanMetric, MeanAcc> = {
    resting_hr: new Map(),
    hrv_sdnn: new Map(),
    respiratory_rate: new Map(),
    walking_hr_avg: new Map(),
    hr_recovery_1min: new Map()
  }
  lasts: Record<LastMetric, LastAcc> = {
    vo2max: new Map(),
    weight_kg: new Map()
  }

  private open: OpenWorkout | null = null

  sourceId(raw: string | undefined): number {
    const name = raw ?? ''
    let id = this.sourceIds.get(name)
    if (id === undefined) {
      id = this.sources.length
      this.sources.push(name)
      this.sourceIds.set(name, id)
    }
    return id
  }

  /** Id of a source name, or -1 when no record came from it. */
  findSourceId(raw: string): number {
    return this.sourceIds.get(raw) ?? -1
  }

  /** Call once after the last element: sorts the sample tables by time. */
  finish(): void {
    this.hr.sort()
    this.power.sort()
    this.distWalkRun.sort()
    this.distSwim.sort()
    this.distCycle.sort()
    this.sleep.sort((a, b) => a.startTs - b.startTs || a.endTs - b.endTs)
  }

  setExportDate(value: string): void {
    this.exportDate = value
  }

  // ---- top-level records -------------------------------------------------------------

  record(a: XmlAttrs): void {
    this.recordCount++
    const type = a.type
    if (!type) return
    if (type.startsWith(QTY)) this.quantity(type.slice(QTY.length), a)
    else if (type === 'HKCategoryTypeIdentifierSleepAnalysis') this.sleepRecord(a)
  }

  private quantity(kind: string, a: XmlAttrs): void {
    switch (kind) {
      case 'HeartRate': {
        const ts = parseHealthTs(a.startDate)
        const bpm = toPerMinute(a.value, a.unit)
        if (ts === ts && bpm !== null) this.hr.push(ts, bpm, this.sourceId(a.sourceName))
        return
      }
      case 'RunningPower': {
        const ts = parseHealthTs(a.startDate)
        const watts = toWatts(a.value, a.unit)
        if (ts === ts && watts !== null) this.power.push(ts, watts, this.sourceId(a.sourceName))
        return
      }
      case 'DistanceWalkingRunning':
        this.distance(this.distWalkRun, a)
        return
      case 'DistanceSwimming':
        this.distance(this.distSwim, a)
        return
      case 'DistanceCycling':
        this.distance(this.distCycle, a)
        return
      case 'StepCount': {
        const n = toCount(a.value, a.unit)
        if (n !== null) this.addByDaySource(this.stepsByDaySource, a, n)
        return
      }
      case 'ActiveEnergyBurned': {
        const kcal = toKcal(a.value, a.unit)
        if (kcal !== null) this.addByDaySource(this.activeKcalByDaySource, a, kcal)
        return
      }
      case 'RestingHeartRate':
        this.addMean('resting_hr', a, toPerMinute(a.value, a.unit))
        return
      case 'WalkingHeartRateAverage':
        this.addMean('walking_hr_avg', a, toPerMinute(a.value, a.unit))
        return
      case 'HeartRateRecoveryOneMinute':
        this.addMean('hr_recovery_1min', a, toPerMinute(a.value, a.unit))
        return
      case 'RespiratoryRate':
        this.addMean('respiratory_rate', a, toPerMinute(a.value, a.unit))
        return
      case 'HeartRateVariabilitySDNN':
        this.addMean('hrv_sdnn', a, toMillis(a.value, a.unit))
        return
      case 'VO2Max':
        // mL/(kg·min); Health writes the unit as 'mL/min·kg'.
        this.addLast('vo2max', a, a.unit && /^ml\/(min·kg|kg·min|\(kg\*min\)|kg\*min)$/i.test(a.unit) ? Number(a.value) : null)
        return
      case 'BodyMass':
        this.addLast('weight_kg', a, toKg(a.value, a.unit))
        return
      default:
        return
    }
  }

  private distance(table: NumTable, a: XmlAttrs): void {
    const start = parseHealthTs(a.startDate)
    const end = parseHealthTs(a.endDate)
    const metres = toMeters(a.value, a.unit)
    if (start !== start || end !== end || metres === null || end < start || metres < 0) return
    table.push(start, end, metres, this.sourceId(a.sourceName))
  }

  private dayOf(a: XmlAttrs): number {
    const ts = parseHealthTs(a.startDate)
    return ts === ts ? localDayNumber(ts, parseOffsetMin(a.startDate)) : NaN
  }

  private addByDaySource(map: Map<number, number>, a: XmlAttrs, value: number): void {
    const day = this.dayOf(a)
    if (day !== day) return
    const src = this.sourceId(a.sourceName)
    if (src >= SOURCE_SLOTS) return
    const key = day * SOURCE_SLOTS + src
    map.set(key, (map.get(key) ?? 0) + value)
  }

  private addMean(metric: MeanMetric, a: XmlAttrs, value: number | null): void {
    if (value === null || !Number.isFinite(value)) return
    const day = this.dayOf(a)
    if (day !== day) return
    const acc = this.means[metric].get(day)
    if (acc) {
      acc[0] += value
      acc[1] += 1
    } else {
      this.means[metric].set(day, [value, 1])
    }
  }

  private addLast(metric: LastMetric, a: XmlAttrs, value: number | null): void {
    if (value === null || !Number.isFinite(value)) return
    const ts = parseHealthTs(a.startDate)
    if (ts !== ts) return
    const day = localDayNumber(ts, parseOffsetMin(a.startDate))
    const acc = this.lasts[metric].get(day)
    if (!acc) this.lasts[metric].set(day, [ts, value])
    else if (ts >= acc[0]) {
      acc[0] = ts
      acc[1] = value
    }
  }

  private sleepRecord(a: XmlAttrs): void {
    const stage = SLEEP_STAGES[a.value ?? '']
    if (!stage) return // InBed and Awake are not sleep
    const startTs = parseHealthTs(a.startDate)
    const endTs = parseHealthTs(a.endDate)
    if (startTs !== startTs || endTs !== endTs || endTs <= startTs) return
    this.sleep.push({ startTs, endTs, tzOffsetMin: parseOffsetMin(a.endDate), stage, source: a.sourceName ?? '' })
  }

  activitySummary(a: XmlAttrs): void {
    const date = a.dateComponents
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    const kcal = toKcal(a.activeEnergyBurned, a.activeEnergyBurnedUnit)
    if (kcal !== null && kcal > 0) this.activitySummaryKcal.set(date, kcal)
  }

  // ---- workouts ----------------------------------------------------------------------

  workoutStart(a: XmlAttrs): void {
    this.open = null
    const startTs = parseHealthTs(a.startDate)
    if (startTs !== startTs) return
    let endTs = parseHealthTs(a.endDate)
    const reported = toSeconds(a.duration, a.durationUnit)
    if (endTs !== endTs || endTs < startTs) endTs = startTs + (reported ?? 0)
    const activityType = (a.workoutActivityType ?? 'Other').replace(/^HKWorkoutActivityType/, '') || 'Other'
    const sourceRaw = a.sourceName ?? ''
    const source = cleanSourceName(sourceRaw)
    this.open = {
      w: {
        activityType,
        sport: sportFromActivityType(activityType),
        sourceRaw,
        source,
        startTs,
        endTs,
        tzOffsetMin: parseOffsetMin(a.startDate),
        durationS: reported ?? endTs - startTs,
        title: null,
        indoor: false,
        userEntered: false,
        externalUuid: null,
        fromWatch: /watch/i.test(source) || /Apple Watch|model:Watch/.test(a.device ?? ''),
        distanceM: null,
        energyKcal: null,
        avgHr: null,
        minHr: null,
        maxHr: null,
        avgPowerW: null,
        avgStrideM: null,
        avgGctMs: null,
        avgVertOscCm: null,
        stepCount: null,
        elevationGainM: null,
        effort: null,
        events: [],
        zones: [],
        routePath: null
      },
      distances: new Map(),
      // Older exports carry the totals as attributes instead of WorkoutStatistics.
      totalDistanceM: toMeters(a.totalDistance, a.totalDistanceUnit),
      totalEnergyKcal: toKcal(a.totalEnergyBurned, a.totalEnergyBurnedUnit),
      estimatedEffort: null,
      zoneUnit: null,
      inHrZoneGroup: false
    }
  }

  workoutChild(name: string, a: XmlAttrs, parent: string): void {
    const o = this.open
    if (!o) return
    const w = o.w
    if (parent === 'Workout') {
      switch (name) {
        case 'MetadataEntry':
          this.workoutMetadata(w, a.key, a.value)
          return
        case 'WorkoutEvent': {
          const type = EVENT_TYPES[a.type ?? '']
          const ts = parseHealthTs(a.date)
          if (type && ts === ts) {
            const event: WorkoutEvent = { type, ts, durationS: toSeconds(a.duration, a.durationUnit) }
            w.events.push(event)
          }
          return
        }
        case 'WorkoutStatistics':
          this.workoutStatistics(o, a)
          return
        case 'WorkoutZoneGroup':
          o.inHrZoneGroup = a.type === `${QTY}HeartRate` && w.zones.length === 0
          o.zoneUnit = a.unit ?? null
          return
        case 'Record': {
          const score = toCount(a.value, a.unit)
          if (score === null) return
          if (a.type === `${QTY}WorkoutEffortScore`) w.effort = score
          else if (a.type === `${QTY}EstimatedWorkoutEffortScore`) o.estimatedEffort = score
          return
        }
        default:
          return
      }
    }
    if (parent === 'WorkoutZoneGroup' && name === 'WorkoutZone' && o.inHrZoneGroup) {
      const seconds = toSeconds(a.duration, a.durationUnit)
      if (seconds === null) return
      const zone: HrZone = {
        minBpm: toPerMinute(a.minimum, o.zoneUnit),
        maxBpm: toPerMinute(a.maximum, o.zoneUnit),
        seconds
      }
      w.zones.push(zone)
      return
    }
    if (parent === 'WorkoutRoute' && name === 'FileReference' && a.path && !w.routePath) {
      w.routePath = a.path
    }
  }

  private workoutMetadata(w: RawWorkout, key: string | undefined, value: string | undefined): void {
    switch (key) {
      case 'HKWorkoutBrandName': {
        const title = (value ?? '').replace(/ /g, ' ').trim()
        if (title) w.title = title
        return
      }
      case 'HKIndoorWorkout':
        w.indoor = value === '1'
        return
      case 'HKWasUserEntered':
        w.userEntered = value === '1'
        return
      case 'HKExternalUUID':
        w.externalUuid = value ?? null
        return
      case 'HKElevationAscended': {
        const q = parseQuantity(value)
        if (q) w.elevationGainM = toMeters(q.value, q.unit)
        return
      }
      default:
        return
    }
  }

  private workoutStatistics(o: OpenWorkout, a: XmlAttrs): void {
    const w = o.w
    const type = a.type ?? ''
    if (!type.startsWith(QTY)) return
    const kind = type.slice(QTY.length)
    switch (kind) {
      case 'ActiveEnergyBurned':
        w.energyKcal = toKcal(a.sum, a.unit) ?? w.energyKcal
        return
      case 'HeartRate':
        w.avgHr = toPerMinute(a.average, a.unit)
        w.minHr = toPerMinute(a.minimum, a.unit)
        w.maxHr = toPerMinute(a.maximum, a.unit)
        return
      case 'StepCount':
        w.stepCount = toCount(a.sum, a.unit)
        return
      case 'RunningPower':
      case 'CyclingPower':
        w.avgPowerW = toWatts(a.average, a.unit)
        return
      case 'RunningStrideLength':
        w.avgStrideM = toMeters(a.average, a.unit)
        return
      case 'RunningGroundContactTime':
        w.avgGctMs = toMillis(a.average, a.unit)
        return
      case 'RunningVerticalOscillation':
        w.avgVertOscCm = toCentimeters(a.average, a.unit)
        return
      default:
        if (kind.startsWith('Distance')) {
          const m = toMeters(a.sum, a.unit)
          if (m !== null) o.distances.set(kind, m)
        }
    }
  }

  workoutEnd(): void {
    const o = this.open
    this.open = null
    if (!o) return
    const w = o.w
    const preferred = w.sport === 'swim' ? 'DistanceSwimming' : w.sport === 'cycle' ? 'DistanceCycling' : 'DistanceWalkingRunning'
    w.distanceM = o.distances.get(preferred) ?? [...o.distances.values()][0] ?? o.totalDistanceM
    if (w.energyKcal === null) w.energyKcal = o.totalEnergyKcal
    if (w.effort === null) w.effort = o.estimatedEffort
    w.events.sort((x, y) => x.ts - y.ts)
    this.workouts.push(w)
  }
}
