// End-to-end import of a small, entirely made-up export, zipped in memory.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ImportProgress } from '../src/shared/api/status'
import { openDatabase, type Db } from '../src/main/db'
import { importHealthExport } from '../src/main/import'
import { makeZip } from './helpers/zip'

const Q = 'HKQuantityTypeIdentifier'
/** Health pads device names with a non-breaking space. */
const WATCH = 'Test Watch '
const PHONE = 'Test Phone'
const DAY1 = '2024-03-02'
const DAY2 = '2024-03-03'

const pad = (n: number): string => String(n).padStart(2, '0')
/** Health timestamp at `seconds` after local midnight of `day` (UTC+1). */
function at(day: string, seconds: number): string {
  const d = new Date(Date.parse(`${day}T00:00:00Z`) + seconds * 1000)
  return `${d.toISOString().slice(0, 10)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0100`
}
const unix = (day: string, seconds: number): number => Date.parse(`${day}T00:00:00Z`) / 1000 + seconds - 3600
const H = 3600

function attrs(a: Record<string, string | number>): string {
  return Object.entries(a)
    .map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    .join('')
}
function record(type: string, source: string, day: string, from: number, to: number, value: string | number, unit?: string): string {
  return ` <Record${attrs({ type, sourceName: source, ...(unit ? { unit } : {}), creationDate: at(day, to), startDate: at(day, from), endDate: at(day, to), value })}/>`
}
const stat = (type: string, a: Record<string, string | number>): string => `  <WorkoutStatistics${attrs({ type: Q + type, ...a })}/>`
const meta = (key: string, value: string | number): string => `  <MetadataEntry${attrs({ key, value })}/>`

function workout(
  type: string,
  source: string,
  day: string,
  from: number,
  to: number,
  durationMin: number,
  children: string[],
  device?: string
): string {
  const open = attrs({
    workoutActivityType: `HKWorkoutActivityType${type}`,
    duration: durationMin,
    durationUnit: 'min',
    sourceName: source,
    ...(device ? { device } : {}),
    startDate: at(day, from),
    endDate: at(day, to)
  })
  return [` <Workout${open}>`, ...children, ' </Workout>'].join('\n')
}

function gpx(points: number, totalM: number, timeOf: (i: number) => string): string {
  const metresPerDegree = 109_639 // of longitude at 10 degrees north, near enough
  const pts = Array.from({ length: points }, (_, i) => {
    const lon = (20 + (i * totalM) / (points - 1) / metresPerDegree).toFixed(6)
    return `<trkpt lon="${lon}" lat="10.000000"><ele>${(50 + i * 0.01).toFixed(2)}</ele><time>${timeOf(i)}</time></trkpt>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>\n${pts.join('\n')}\n</trkseg></trk></gpx>\n`
}

function buildExportXml(): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE HealthData [',
    '<!-- HealthKit Export Version: 14 -->',
    '<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord)*)>',
    '<!ATTLIST HealthData',
    '  locale CDATA #REQUIRED',
    '>',
    '<!ELEMENT Record ((MetadataEntry|HeartRateVariabilityMetadataList)*)>',
    ']>',
    '<HealthData locale="en_US">',
    ' <ExportDate value="2024-03-04 08:00:00 +0100"/>',
    ' <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-01-01"/>'
  ]
  const RUN = 10 * H

  // The run app logs distance every 10 s: 10 min at 2.5 m/s, 10 min at 3 m/s, 10 min at 2.8333 m/s.
  for (let i = 0; i < 180; i++) {
    const km = i < 60 ? '0.025' : i < 120 ? '0.03' : '0.028333'
    out.push(record(`${Q}DistanceWalkingRunning`, 'RunApp', DAY1, RUN + i * 10, RUN + i * 10 + 10, km, 'km'))
  }
  // Strava's copy restates the total in one record; so does the manual entry.
  out.push(record(`${Q}DistanceWalkingRunning`, 'Strava', DAY1, RUN, RUN + 1806, '5.001', 'km'))
  out.push(record(`${Q}DistanceWalkingRunning`, 'Fitness', DAY1, RUN + 600, RUN + 660, '0.01', 'km'))
  out.push(record(`${Q}DistanceWalkingRunning`, PHONE, DAY1, RUN, RUN + 600, '9', 'furlong')) // unknown unit: ignored
  // Day 2: only the phone's pedometer blocks and Strava's summary.
  for (let i = 0; i < 4; i++) out.push(record(`${Q}DistanceWalkingRunning`, PHONE, DAY2, 8 * H + i * 450, 8 * H + (i + 1) * 450, '1.2', 'km'))
  out.push(record(`${Q}DistanceWalkingRunning`, 'Strava', DAY2, 8 * H, 8 * H + 1800, '5', 'km'))

  for (let i = 0; i <= 60; i++) {
    out.push(record(`${Q}HeartRate`, WATCH, DAY1, RUN + i * 30, RUN + i * 30, i < 30 ? 150 : 160, 'count/min'))
  }
  // A record with children, as Health writes for heart-rate context and HRV beats.
  out.push(
    ` <Record${attrs({ type: `${Q}HeartRateVariabilitySDNN`, sourceName: WATCH, unit: 'ms', startDate: at(DAY1, 3 * H), endDate: at(DAY1, 3 * H + 60), value: 40 })}>`,
    '  <HeartRateVariabilityMetadataList>',
    '   <InstantaneousBeatsPerMinute bpm="52" time="3:00:01,00"/>',
    '  </HeartRateVariabilityMetadataList>',
    '  <MetadataEntry key="HKWorkoutBrandName" value="Not a workout title"/>',
    ' </Record>'
  )
  out.push(record(`${Q}HeartRateVariabilitySDNN`, WATCH, DAY1, 5 * H, 5 * H + 60, 60, 'ms'))
  out.push(record(`${Q}RestingHeartRate`, WATCH, DAY1, 0, 20 * H, 50, 'count/min'))
  out.push(record(`${Q}WalkingHeartRateAverage`, WATCH, DAY1, 0, 20 * H, 95, 'count/min'))
  out.push(record(`${Q}HeartRateRecoveryOneMinute`, WATCH, DAY1, RUN + 1800, RUN + 1860, 30, 'count/min'))
  out.push(record(`${Q}RespiratoryRate`, WATCH, DAY1, 2 * H, 2 * H + 60, 14, 'count/min'))
  out.push(record(`${Q}RespiratoryRate`, WATCH, DAY1, 4 * H, 4 * H + 60, 16, 'count/min'))
  out.push(record(`${Q}VO2Max`, WATCH, DAY1, RUN + 1800, RUN + 1800, 41.5, 'mL/min·kg'))
  out.push(record(`${Q}BodyMass`, 'Scale', DAY1, 7 * H, 7 * H, 176.37, 'lb'))
  out.push(record(`${Q}BodyMass`, 'Scale', DAY1, 20 * H, 20 * H, 79.5, 'kg'))
  out.push(record(`${Q}StepCount`, PHONE, DAY1, 9 * H, 10 * H, 4000, 'count'))
  out.push(record(`${Q}StepCount`, PHONE, DAY1, 15 * H, 16 * H, 3000, 'count'))
  out.push(record(`${Q}StepCount`, WATCH, DAY1, 9 * H, 16 * H, 6500, 'count'))
  out.push(record(`${Q}ActiveEnergyBurned`, PHONE, DAY1, 9 * H, 10 * H, 99, 'kcal'))
  out.push(record(`${Q}ActiveEnergyBurned`, PHONE, DAY2, 9 * H, 10 * H, 120, 'kcal'))
  out.push(record(`${Q}ActiveEnergyBurned`, WATCH, DAY2, 9 * H, 10 * H, 200, 'kcal'))

  // The night before day 1: 23:00 to 06:30 with ten minutes awake.
  const sleep = (from: number, to: number, value: string, source = WATCH): string =>
    record('HKCategoryTypeIdentifierSleepAnalysis', source, DAY1, from, to, `HKCategoryValueSleepAnalysis${value}`)
  out.push(sleep(-1.5 * H, 7 * H, 'InBed', PHONE))
  out.push(sleep(-1 * H, 1 * H, 'AsleepCore'))
  out.push(sleep(1 * H, 2 * H, 'AsleepDeep'))
  out.push(sleep(2 * H, 2 * H + 600, 'Awake'))
  out.push(sleep(2 * H + 600, 4 * H, 'AsleepREM'))
  out.push(sleep(4 * H, 6.5 * H, 'AsleepCore'))

  // --- workouts ---
  out.push(
    workout(
      'Running',
      'RunApp',
      DAY1,
      RUN,
      RUN + 1810,
      30,
      [
        meta('HKIndoorWorkout', 0),
        meta('HKWorkoutBrandName', '5 km Easy Run'),
        `  <WorkoutEvent${attrs({ type: 'HKWorkoutEventTypeLap', date: at(DAY1, RUN), duration: 15, durationUnit: 'min' })}/>`,
        `  <WorkoutEvent${attrs({ type: 'HKWorkoutEventTypeLap', date: at(DAY1, RUN + 900), duration: 15, durationUnit: 'min' })}/>`,
        `  <WorkoutEvent${attrs({ type: 'HKWorkoutEventTypePause', date: at(DAY1, RUN + 1800) })}/>`,
        stat('DistanceWalkingRunning', { sum: 5, unit: 'km' }),
        stat('ActiveEnergyBurned', { sum: 380, unit: 'kcal' }),
        stat('HeartRate', { average: 155, minimum: 150, maximum: 160, unit: 'count/min' }),
        stat('StepCount', { sum: 5200, unit: 'count' }),
        stat('RunningPower', { average: 210, minimum: 150, maximum: 260, unit: 'W' }),
        stat('RunningStrideLength', { average: 0.95, unit: 'm' }),
        stat('RunningGroundContactTime', { average: 280, unit: 'ms' }),
        stat('RunningVerticalOscillation', { average: 9.5, unit: 'cm' }),
        meta('HKElevationAscended', '1250 cm'),
        `  <WorkoutRoute${attrs({ sourceName: 'RunApp', startDate: at(DAY1, RUN), endDate: at(DAY1, RUN + 1800) })}>`,
        '   <MetadataEntry key="HKMetadataKeySyncVersion" value="2"/>',
        '   <FileReference path="/workout-routes/route_2024-03-02_10.30am.gpx"/>',
        '  </WorkoutRoute>',
        `  <Record${attrs({ type: `${Q}EstimatedWorkoutEffortScore`, sourceName: WATCH, unit: 'appleEffortScore', startDate: at(DAY1, RUN), endDate: at(DAY1, RUN + 1810), value: 6 })}/>`
      ],
      '<<HKDevice: 0x1>, name:Apple Watch, manufacturer:Apple Inc., model:Watch>'
    )
  )
  out.push(
    workout('Running', 'Strava', DAY1, RUN, RUN + 1806, 30.1, [
      meta('HKIndoorWorkout', 0),
      meta('HKExternalUUID', 'strava://activities/1'),
      stat('DistanceWalkingRunning', { sum: 5.001, unit: 'km' }),
      stat('ActiveEnergyBurned', { sum: 400, unit: 'kcal' })
    ])
  )
  out.push(
    workout('Running', 'Fitness', DAY1, RUN + 600, RUN + 660, 1, [
      meta('HKWasUserEntered', 1),
      stat('DistanceWalkingRunning', { sum: 0.01, unit: 'km' }),
      stat('ActiveEnergyBurned', { sum: 305, unit: 'kcal' })
    ])
  )
  out.push(
    workout('FunctionalStrengthTraining', WATCH, DAY1, 18 * H, 19 * H, 60, [
      meta('HKIndoorWorkout', 1),
      // metadata of an event must not be mistaken for the workout's
      `  <WorkoutEvent${attrs({ type: 'HKWorkoutEventTypeSegment', date: at(DAY1, 18 * H), duration: 60, durationUnit: 'min' })}>`,
      '   <MetadataEntry key="HKWorkoutBrandName" value="Wrong"/>',
      '  </WorkoutEvent>',
      stat('ActiveEnergyBurned', { sum: 300, unit: 'kcal' }),
      stat('HeartRate', { average: 110, minimum: 80, maximum: 140, unit: 'count/min' }),
      '  <WorkoutZoneGroup type="HKQuantityTypeIdentifierHeartRate" source="system" unit="count/min">',
      '   <WorkoutZone maximum="130" duration="10" durationUnit="min"/>',
      '   <WorkoutZone minimum="130" maximum="145" duration="20" durationUnit="min"/>',
      '   <WorkoutZone minimum="145" maximum="160" duration="15" durationUnit="min"/>',
      '   <WorkoutZone minimum="160" maximum="175" duration="10" durationUnit="min"/>',
      '   <WorkoutZone minimum="175" duration="5" durationUnit="min"/>',
      '  </WorkoutZoneGroup>',
      `  <Record${attrs({ type: `${Q}EstimatedWorkoutEffortScore`, sourceName: WATCH, unit: 'appleEffortScore', startDate: at(DAY1, 18 * H), endDate: at(DAY1, 19 * H), value: 4 })}/>`,
      `  <Record${attrs({ type: `${Q}WorkoutEffortScore`, sourceName: WATCH, unit: 'appleEffortScore', startDate: at(DAY1, 18 * H), endDate: at(DAY1, 19 * H), value: 6 })}/>`
    ])
  )
  out.push(
    workout('Running', 'Strava', DAY2, 8 * H, 8 * H + 1800, 30, [
      meta('HKExternalUUID', 'strava://activities/2'),
      stat('DistanceWalkingRunning', { sum: 5, unit: 'km' }),
      `  <WorkoutRoute${attrs({ sourceName: 'Strava', startDate: at(DAY2, 20 * H), endDate: at(DAY2, 20 * H) })}>`,
      '   <FileReference path="/workout-routes/route_2024-03-03_8.00pm.gpx"/>',
      '  </WorkoutRoute>'
    ])
  )

  out.push(` <ActivitySummary${attrs({ dateComponents: DAY1, activeEnergyBurned: 450, activeEnergyBurnedGoal: 500, activeEnergyBurnedUnit: 'kcal', appleExerciseTime: 45 })}/>`)
  out.push(` <ActivitySummary${attrs({ dateComponents: DAY2, activeEnergyBurned: 0, activeEnergyBurnedGoal: 500, activeEnergyBurnedUnit: 'kcal', appleExerciseTime: 0 })}/>`)
  out.push('</HealthData>', '')
  return out.join('\n')
}

function buildZip(xmlName = 'Export.xml'): Buffer {
  const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')
  const runStartMs = unix(DAY1, 10 * H) * 1000
  return makeZip({
    [`apple_health_export/${xmlName}`]: buildExportXml(),
    [`apple_health_export/${xmlName.replace(/\.xml$/, '_cda.xml')}`]: '<?xml version="1.0"?><ClinicalDocument/>',
    'apple_health_export/workout-routes/route_2024-03-02_10.30am.gpx': gpx(181, 5000, (i) => iso(runStartMs + i * 10_000)),
    // written by a third-party app: every point carries the time the route was saved
    'apple_health_export/workout-routes/route_2024-03-03_8.00pm.gpx': gpx(50, 5000, () => '2024-03-03T19:00:00Z'),
    'apple_health_export/electrocardiograms/ecg_2024-03-01.csv': 'Name,Test\n'
  })
}

const TABLES = ['workouts', 'laps', 'splits', 'hr_zones', 'best_efforts', 'streams', 'daily_metrics']
const dump = (db: Db): string => JSON.stringify(TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()))
const rows = <T>(db: Db, sql: string, ...params: (string | number)[]): T[] => db.prepare(sql).all(...params) as T[]

describe('importHealthExport', () => {
  let dir: string
  let zipPath: string
  let db: Db

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fd-import-test-'))
    zipPath = join(dir, 'export.zip')
    writeFileSync(zipPath, buildZip())
    db = openDatabase(':memory:')
  })
  afterAll(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('imports the export and reports progress', async () => {
    const progress: ImportProgress[] = []
    const summary = await importHealthExport(db, zipPath, (p) => progress.push(p))
    expect(summary).toMatchObject({
      fileName: 'export.zip',
      exportDate: '2024-03-04 08:00:00 +0100',
      workoutsTotal: 3,
      workoutsNew: 3,
      duplicatesSkipped: 2
    })
    expect(summary.durationMs).toBeGreaterThanOrEqual(0)

    expect(progress[0].phase).toBe('reading')
    expect(progress[progress.length - 1]).toMatchObject({ phase: 'done', fraction: 1 })
    expect(new Set(progress.map((p) => p.phase))).toEqual(new Set(['reading', 'processing', 'writing', 'done']))
    for (let i = 1; i < progress.length; i++) expect(progress[i].fraction).toBeGreaterThanOrEqual(progress[i - 1].fraction)
  })

  it('keeps one row per session, the titled original winning over the copies', () => {
    const all = rows<Record<string, unknown>>(db, 'SELECT * FROM workouts ORDER BY start_ts')
    expect(all.map((w) => w.uid)).toEqual([
      `Running|${unix(DAY1, 10 * H)}|RunApp`,
      `FunctionalStrengthTraining|${unix(DAY1, 18 * H)}|Test Watch`,
      `Running|${unix(DAY2, 8 * H)}|Strava`
    ])
    expect(all[0]).toMatchObject({
      sport: 'run',
      activity_type: 'Running',
      category: 'easy',
      title: '5 km Easy Run',
      source: 'RunApp',
      start_ts: unix(DAY1, 10 * H),
      end_ts: unix(DAY1, 10 * H) + 1810,
      tz_offset_min: 60,
      local_date: DAY1,
      duration_s: 1800,
      distance_m: 5000,
      energy_kcal: 380,
      avg_hr: 155,
      min_hr: 150,
      max_hr: 160,
      avg_power_w: 210,
      avg_stride_m: 0.95,
      avg_gct_ms: 280,
      avg_vert_osc_cm: 9.5,
      step_count: 5200,
      elevation_gain_m: 12.5,
      effort: 6,
      indoor: 0,
      user_entered: 0,
      has_route: 1
    })
    expect(all[1]).toMatchObject({
      sport: 'strength',
      category: 'strength',
      title: null,
      source: 'Test Watch',
      duration_s: 3600,
      distance_m: null,
      energy_kcal: 300,
      avg_hr: 110,
      effort: 6,
      indoor: 1,
      has_route: 0
    })
    expect(all[2]).toMatchObject({ sport: 'run', category: 'other', title: null, source: 'Strava', local_date: DAY2, distance_m: 5000, has_route: 1 })
  })

  it('derives streams, laps, splits and best efforts for the run', () => {
    const streams = Object.fromEntries(
      rows<{ kind: string; data: string }>(db, 'SELECT kind, data FROM streams WHERE workout_id = 1').map((s) => [s.kind, JSON.parse(s.data)])
    )
    expect(Object.keys(streams).sort()).toEqual(['dist', 'hr', 'route'])
    expect(streams.hr).toHaveLength(61)
    expect(streams.hr[0]).toEqual([0, 150])
    expect(streams.dist[0]).toEqual([0, 0])
    expect(streams.dist[streams.dist.length - 1]).toEqual([1800, 5000])
    expect(streams.route).toHaveLength(181)
    expect(streams.route[0]).toEqual([20, 10, 50, 0])
    expect(streams.route[180][3]).toBe(1800)

    const splits = rows<{ distance_m: number; duration_s: number; avg_hr: number }>(db, 'SELECT * FROM splits WHERE workout_id = 1 ORDER BY idx')
    expect(splits.map((s) => s.distance_m)).toEqual([1000, 1000, 1000, 1000, 1000])
    const expected = [400, 200 + 500 / 3, 1000 / 3, 100 + 700 / (17 / 6), 1000 / (17 / 6)]
    splits.forEach((s, i) => expect(Math.abs(s.duration_s - expected[i])).toBeLessThan(0.5))
    expect(splits.reduce((sum, s) => sum + s.duration_s, 0)).toBeCloseTo(1800, 0)
    expect(splits[0].avg_hr).toBe(150)
    expect(splits[4].avg_hr).toBe(160)

    const efforts = rows<{ distance_m: number; duration_s: number; start_offset_s: number }>(
      db,
      'SELECT * FROM best_efforts WHERE workout_id = 1 ORDER BY distance_m'
    )
    expect(efforts.map((e) => e.distance_m)).toEqual([1000, 5000])
    expect(Math.abs(efforts[0].duration_s - 1000 / 3)).toBeLessThan(0.5)
    expect(efforts[0].start_offset_s).toBeGreaterThanOrEqual(599)
    expect(efforts[0].start_offset_s).toBeLessThanOrEqual(868)
    expect(efforts[1]).toMatchObject({ duration_s: 1800, start_offset_s: 0 })

    const laps = rows<Record<string, number>>(db, 'SELECT * FROM laps WHERE workout_id = 1 ORDER BY idx')
    expect(laps).toHaveLength(2)
    expect(laps[0]).toMatchObject({ idx: 1, start_offset_s: 0, duration_s: 900 })
    expect(laps[1]).toMatchObject({ idx: 2, start_offset_s: 900, duration_s: 900, avg_hr: 160 })
    expect(laps[0].distance_m).toBeCloseTo(2400, 0)
    expect(laps[1].distance_m).toBeCloseTo(2600, 0)
  })

  it('stores heart-rate zones in order', () => {
    const zones = rows<Record<string, number | null>>(db, 'SELECT zone, min_bpm, max_bpm, seconds FROM hr_zones WHERE workout_id = 2 ORDER BY zone')
    expect(zones).toEqual([
      { zone: 1, min_bpm: null, max_bpm: 130, seconds: 600 },
      { zone: 2, min_bpm: 130, max_bpm: 145, seconds: 1200 },
      { zone: 3, min_bpm: 145, max_bpm: 160, seconds: 900 },
      { zone: 4, min_bpm: 160, max_bpm: 175, seconds: 600 },
      { zone: 5, min_bpm: 175, max_bpm: null, seconds: 300 }
    ])
    expect(rows(db, 'SELECT * FROM hr_zones WHERE workout_id != 2')).toEqual([])
  })

  it('uses pedometer blocks when nothing better exists, and a route without usable times', () => {
    const streams = Object.fromEntries(
      rows<{ kind: string; data: string }>(db, 'SELECT kind, data FROM streams WHERE workout_id = 3').map((s) => [s.kind, JSON.parse(s.data)])
    )
    expect(Object.keys(streams).sort()).toEqual(['dist', 'route'])
    // four blocks of the phone, scaled from 4.8 km to the workout's 5 km; not Strava's single record
    expect(streams.dist).toEqual([
      [0, 0],
      [450, 1250],
      [900, 2500],
      [1350, 3750],
      [1800, 5000]
    ])
    expect(streams.route).toHaveLength(50)
    expect(streams.route.every((p: (number | null)[]) => p[3] === null && typeof p[0] === 'number')).toBe(true)
    const splits = rows<{ duration_s: number }>(db, 'SELECT duration_s FROM splits WHERE workout_id = 3 ORDER BY idx')
    expect(splits.map((s) => s.duration_s)).toEqual([360, 360, 360, 360, 360])
    expect(rows(db, 'SELECT distance_m, duration_s FROM best_efforts WHERE workout_id = 3 ORDER BY 1')).toEqual([
      { distance_m: 1000, duration_s: 360 },
      { distance_m: 5000, duration_s: 1800 }
    ])
  })

  it('writes one value per day and metric', () => {
    const daily = Object.fromEntries(
      rows<{ date: string; metric: string; value: number }>(db, 'SELECT * FROM daily_metrics').map((r) => [`${r.date} ${r.metric}`, r.value])
    )
    expect(daily).toEqual({
      [`${DAY1} active_kcal`]: 450, // Apple's summary, not the phone's 99
      [`${DAY2} active_kcal`]: 200, // no summary value: the larger source
      [`${DAY1} hr_recovery_1min`]: 30,
      [`${DAY1} hrv_sdnn`]: 50,
      [`${DAY1} respiratory_rate`]: 15,
      [`${DAY1} resting_hr`]: 50,
      [`${DAY1} sleep_hours`]: 7.333,
      [`${DAY1} sleep_core_hours`]: 4.5,
      [`${DAY1} sleep_deep_hours`]: 1,
      [`${DAY1} sleep_rem_hours`]: 1.833,
      [`${DAY1} steps`]: 7000, // phone 4000 + 3000 beats the watch's 6500; never 13500
      [`${DAY1} vo2max`]: 41.5,
      [`${DAY1} walking_hr_avg`]: 95,
      [`${DAY1} weight_kg`]: 79.5
    })
  })

  it('is idempotent and leaves user edits alone', async () => {
    const before = dump(db)
    const uid = `Running|${unix(DAY2, 8 * H)}|Strava`
    db.prepare('INSERT INTO workout_overrides (uid, category) VALUES (?, ?)').run(uid, 'long')

    const summary = await importHealthExport(db, zipPath)
    expect(summary).toMatchObject({ workoutsTotal: 3, workoutsNew: 0, duplicatesSkipped: 2 })
    expect(dump(db)).toBe(before)
    expect(rows(db, 'SELECT * FROM workout_overrides')).toEqual([{ uid, category: 'long' }])
    expect(rows(db, 'SELECT cat, cat_overridden FROM workouts_v WHERE uid = ?', uid)).toEqual([{ cat: 'long', cat_overridden: 1 }])
    expect(rows<{ workouts_total: number; workouts_new: number; duplicates_skipped: number }>(db, 'SELECT workouts_total, workouts_new, duplicates_skipped FROM imports ORDER BY id')).toEqual([
      { workouts_total: 3, workouts_new: 3, duplicates_skipped: 2 },
      { workouts_total: 3, workouts_new: 0, duplicates_skipped: 2 }
    ])
  })

  it('finds the export under a localised file name', async () => {
    const other = join(dir, 'localised.zip')
    writeFileSync(other, buildZip('exportar.xml'))
    const fresh = openDatabase(':memory:')
    try {
      expect(await importHealthExport(fresh, other)).toMatchObject({ workoutsTotal: 3, workoutsNew: 3 })
    } finally {
      fresh.close()
    }
  })

  it('rejects unusable files with a readable message and changes nothing', async () => {
    const before = dump(db)
    const imports = rows(db, 'SELECT id FROM imports').length

    const notZip = join(dir, 'notes.zip')
    writeFileSync(notZip, 'this is a text file, not an archive')
    await expect(importHealthExport(db, notZip)).rejects.toThrow(/"notes\.zip" is not a zip file/)

    const noXml = join(dir, 'photos.zip')
    writeFileSync(noXml, makeZip({ 'holiday/readme.txt': 'hello', 'apple_health_export/export_cda.xml': '<ClinicalDocument/>' }))
    await expect(importHealthExport(db, noXml)).rejects.toThrow(/"photos\.zip" is not an Apple Health export: there is no export\.xml inside/)

    const otherXml = join(dir, 'other.zip')
    writeFileSync(otherXml, makeZip({ 'export.xml': '<?xml version="1.0"?><catalog><item/></catalog>' }))
    await expect(importHealthExport(db, otherXml)).rejects.toThrow(/not an Apple Health export/)

    const broken = join(dir, 'broken.zip')
    writeFileSync(broken, makeZip({ 'export.xml': '<HealthData locale="en_US"><Record type="x"' }))
    await expect(importHealthExport(db, broken)).rejects.toThrow(/damaged/)

    await expect(importHealthExport(db, join(dir, 'missing.zip'))).rejects.toThrow(/File not found/)

    expect(dump(db)).toBe(before)
    expect(rows(db, 'SELECT id FROM imports')).toHaveLength(imports)
  })
})
