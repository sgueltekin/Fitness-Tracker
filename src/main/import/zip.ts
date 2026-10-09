// Reads entries straight out of the export zip; nothing is extracted to disk.
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { Readable } from 'node:stream'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { ImportError } from './xml'

export interface HealthZip {
  /** Entries that are files, by full name inside the zip. */
  entries: Entry[]
  openStream(entry: Entry): Promise<Readable>
  readText(entry: Entry): Promise<string>
  close(): void
}

export async function openHealthZip(zipPath: string): Promise<HealthZip> {
  if (!existsSync(zipPath)) throw new ImportError(`File not found: ${zipPath}`)
  const name = basename(zipPath)

  const zip = await new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, opened) => {
      if (err || !opened) {
        reject(new ImportError(`"${name}" is not a zip file. Choose the zip that "Export All Health Data" in the Health app creates.`))
      } else resolve(opened)
    })
  })

  let entries: Entry[]
  try {
    entries = await new Promise<Entry[]>((resolve, reject) => {
      const found: Entry[] = []
      zip.on('entry', (entry: Entry) => {
        if (!entry.fileName.endsWith('/')) found.push(entry)
        zip.readEntry()
      })
      zip.once('end', () => resolve(found))
      zip.once('error', reject)
      zip.readEntry()
    })
  } catch {
    zip.close()
    throw new ImportError(`"${name}" is damaged: its list of files could not be read.`)
  }

  const openStream = (entry: Entry): Promise<Readable> =>
    new Promise((resolve, reject) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) reject(new ImportError(`"${name}" is damaged: ${entry.fileName} could not be read.`))
        else resolve(stream)
      })
    })

  return {
    entries,
    openStream,
    async readText(entry) {
      const stream = await openStream(entry)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      return Buffer.concat(chunks).toString('utf8')
    },
    close: () => zip.close()
  }
}

function depthOf(fileName: string): number {
  return fileName.split('/').length
}

/**
 * The main export file. Health names it export.xml (the casing and, in some languages, the
 * word itself vary) and puts the clinical document export_cda.xml next to it.
 */
export function findExportXml(entries: Entry[]): Entry | null {
  const shallowestFirst = (a: Entry, b: Entry): number => depthOf(a.fileName) - depthOf(b.fileName)
  const exact = entries.filter((e) => /(^|\/)export\.xml$/i.test(e.fileName)).sort(shallowestFirst)
  if (exact.length) return exact[0]
  // Localised name: the largest xml file near the top that is not the clinical document.
  const others = entries
    .filter((e) => /\.xml$/i.test(e.fileName) && !/_cda\.xml$/i.test(e.fileName) && depthOf(e.fileName) <= 2)
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize)
  return others[0] ?? null
}

/** Finds the zip entry a <FileReference path="/workout-routes/route_x.gpx"> points to. */
export function routeEntryIndex(entries: Entry[]): (path: string) => Entry | null {
  const byName = new Map<string, Entry>()
  for (const e of entries) {
    const m = /(^|\/)(workout-routes\/[^/]+\.gpx)$/i.exec(e.fileName)
    if (m) byName.set(m[2].toLowerCase(), e)
  }
  return (path) => byName.get(path.replace(/^\/+/, '').toLowerCase()) ?? null
}
