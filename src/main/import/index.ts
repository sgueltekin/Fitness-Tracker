import { basename } from 'node:path'
import type { ImportProgress, ImportSummary } from '@shared/api/status'
import type { Db } from '../db'
import { buildWorkoutRecord, type WorkoutRoute } from './build'
import { HealthCollector } from './collect'
import { buildDailyMetrics } from './daily'
import { dedupeWorkouts } from './dedupe'
import { parseGpx, trackHasUsableTimes, type Track } from './gpx'
import { assignRoutes } from './routes'
import type { RawWorkout, WorkoutRecord } from './types'
import { writeImport } from './write'
import { ImportError, parseHealthXml } from './xml'
import { findExportXml, openHealthZip, routeEntryIndex, type HealthZip } from './zip'

export { ImportError } from './xml'

/** Share of the progress bar each phase gets. */
const READ_END = 0.82
const PROCESS_END = 0.96

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * Imports an Apple Health "Export All Health Data" zip into the database.
 * Must not import from 'electron': it also runs from the CLI (scripts/import.mts) and in tests.
 *
 * One streaming pass over export.xml inside the zip collects workouts and samples; the
 * workouts are then deduplicated, enriched with streams, laps, splits and best efforts,
 * and written together with the daily metrics in a single transaction that replaces all
 * derived tables. Rejects with an ImportError (user-readable message) for unusable input.
 */
export async function importHealthExport(
  db: Db,
  zipPath: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportSummary> {
  const startedAt = Date.now()
  const fileName = basename(zipPath)

  let lastKey = ''
  const progress = (phase: ImportProgress['phase'], fraction: number, message: string): void => {
    if (!onProgress) return
    const f = Math.min(1, Math.max(0, fraction))
    const key = `${phase}|${Math.floor(f * 100)}|${message}`
    if (key === lastKey) return
    lastKey = key
    onProgress({ phase, fraction: f, message })
  }

  progress('reading', 0, 'Opening the export')
  const zip = await openHealthZip(zipPath)
  try {
    const xmlEntry = findExportXml(zip.entries)
    if (!xmlEntry) {
      throw new ImportError(
        `"${fileName}" is not an Apple Health export: there is no export.xml inside. Choose the zip that "Export All Health Data" in the Health app creates.`
      )
    }

    const collector = new HealthCollector()
    const totalBytes = Math.max(1, xmlEntry.uncompressedSize)
    await parseHealthXml(await zip.openStream(xmlEntry), collector, (bytes) => {
      progress('reading', READ_END * Math.min(1, bytes / totalBytes), 'Reading health data')
    })
    collector.finish()

    progress('processing', READ_END, 'Matching duplicate workouts')
    await yieldToEventLoop()
    const { kept, duplicatesSkipped } = dedupeWorkouts(collector.workouts)

    const routes = await loadRoutes(zip, kept)
    const records: WorkoutRecord[] = []
    for (let i = 0; i < kept.length; i++) {
      records.push(buildWorkoutRecord(kept[i], collector, routes.get(kept[i]) ?? null))
      progress('processing', READ_END + (PROCESS_END - READ_END) * ((i + 1) / kept.length), `Processing workouts (${i + 1} of ${kept.length})`)
      if (i % 4 === 3) await yieldToEventLoop()
    }
    const daily = buildDailyMetrics(collector)

    progress('writing', PROCESS_END, 'Saving')
    await yieldToEventLoop()
    const result = writeImport(db, records, daily, {
      fileName,
      exportDate: collector.exportDate,
      importedAt: Date.now(),
      duplicatesSkipped,
      startedAt
    })

    progress('done', 1, `Imported ${result.workoutsTotal} workouts`)
    return {
      fileName,
      exportDate: collector.exportDate,
      workoutsTotal: result.workoutsTotal,
      workoutsNew: result.workoutsNew,
      duplicatesSkipped,
      durationMs: Date.now() - startedAt
    }
  } finally {
    zip.close()
  }
}

/** Reads the GPX file of every workout that has one and decides which workout may use it. */
async function loadRoutes(zip: HealthZip, workouts: RawWorkout[]): Promise<Map<RawWorkout, WorkoutRoute>> {
  const findEntry = routeEntryIndex(zip.entries)
  const tracks = new Map<string, Track>()
  for (const w of workouts) {
    if (!w.routePath || tracks.has(w.routePath)) continue
    const entry = findEntry(w.routePath)
    if (!entry) continue
    tracks.set(w.routePath, parseGpx(await zip.readText(entry)))
    await yieldToEventLoop()
  }

  const out = new Map<RawWorkout, WorkoutRoute>()
  for (const [w, track] of assignRoutes(workouts, tracks)) {
    out.set(w, { track, timesUsable: trackHasUsableTimes(track, w.startTs, w.endTs) })
  }
  return out
}
