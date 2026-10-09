// One streaming pass over Apple Health's export.xml. Elements are handed to a handler
// as they are read; nothing of the document is kept.
import { SaxesParser } from 'saxes'

export type XmlAttrs = Record<string, string | undefined>

export interface HealthXmlHandler {
  setExportDate(value: string): void
  /** A top-level <Record>. */
  record(attrs: XmlAttrs): void
  activitySummary(attrs: XmlAttrs): void
  workoutStart(attrs: XmlAttrs): void
  /** Any element below a <Workout>; `parent` is the name of its parent element. */
  workoutChild(name: string, attrs: XmlAttrs, parent: string): void
  workoutEnd(): void
}

/** Thrown for input the user can do something about; the message is shown as-is. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** How many decompressed bytes to parse before letting other events run. */
const YIELD_EVERY_BYTES = 4 * 1024 * 1024

/**
 * Parses the export from a stream of UTF-8 bytes. `onBytes` receives the number of
 * bytes consumed so far. Rejects with an ImportError when the stream is not a Health export.
 */
export async function parseHealthXml(
  stream: AsyncIterable<Buffer>,
  handler: HealthXmlHandler,
  onBytes?: (bytes: number) => void
): Promise<void> {
  const parser = new SaxesParser()
  let depth = 0
  let sawRoot = false
  let inWorkout = false
  const path: string[] = []
  // Held in an object so that assignments from the parser callbacks are visible to the type checker.
  const state: { failure: Error | null } = { failure: null }

  parser.on('error', (err) => {
    state.failure ??= new ImportError(`The export file is damaged and could not be read (${err.message.replace(/\s+/g, ' ').trim()}).`)
  })

  parser.on('opentag', (tag) => {
    depth++
    const name = tag.name
    const attrs = tag.attributes as XmlAttrs
    if (depth === 1) {
      if (name !== 'HealthData') {
        state.failure ??= new ImportError('This file is not an Apple Health export: its export.xml does not contain health data.')
        return
      }
      sawRoot = true
    } else if (depth === 2) {
      if (name === 'Record') handler.record(attrs)
      else if (name === 'Workout') {
        handler.workoutStart(attrs)
        inWorkout = true
        path.length = 0
      } else if (name === 'ActivitySummary') handler.activitySummary(attrs)
      else if (name === 'ExportDate' && attrs.value) handler.setExportDate(attrs.value)
    } else if (inWorkout) {
      handler.workoutChild(name, attrs, path[path.length - 1])
    }
    if (inWorkout) path.push(name)
  })

  parser.on('closetag', () => {
    if (inWorkout) {
      path.pop()
      if (depth === 2) {
        inWorkout = false
        handler.workoutEnd()
      }
    }
    depth--
  })

  const decoder = new TextDecoder('utf-8')
  let bytes = 0
  let sinceYield = 0
  for await (const chunk of stream) {
    bytes += chunk.length
    sinceYield += chunk.length
    parser.write(decoder.decode(chunk, { stream: true }))
    if (state.failure) throw state.failure
    onBytes?.(bytes)
    if (sinceYield >= YIELD_EVERY_BYTES) {
      sinceYield = 0
      await yieldToEventLoop()
    }
  }
  parser.write(decoder.decode())
  parser.close()
  if (state.failure) throw state.failure
  if (!sawRoot) throw new ImportError('This file is not an Apple Health export: its export.xml is empty.')
}
