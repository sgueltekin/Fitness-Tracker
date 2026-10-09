// Imports an Apple Health export zip from the command line:
//   npm run import -- "C:\path\to\export.zip"
// Writes to data/fitness.db (or FD_DB).
import { devDbPath, openDatabase } from '../src/main/db'
import { importHealthExport } from '../src/main/import'

const zip = process.argv[2]
if (!zip) {
  console.error('Usage: npm run import -- <path to export.zip>')
  process.exit(1)
}

const db = openDatabase(devDbPath())
let last = ''
const summary = await importHealthExport(db, zip, (p) => {
  const line = `${p.phase} ${(p.fraction * 100).toFixed(0)}% ${p.message}`
  if (line !== last) console.log(line)
  last = line
})
console.log(summary)
db.close()
