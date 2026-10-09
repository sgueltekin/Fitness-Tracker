// Calls one API method against data/fitness.db (or FD_DB) and prints the result as JSON:
//   npm run query -- getOverview 12w
//   npm run query -- getWorkout 12
//   npm run query -- getActivities "{\"sport\":\"run\"}"
// Arguments are parsed as JSON when possible, otherwise passed as strings.
import { API_METHODS, type ApiMethod } from '../src/shared/api'
import { createApi } from '../src/main/api'
import { devDbPath, openDatabase } from '../src/main/db'

const [method, ...rawArgs] = process.argv.slice(2)
if (!API_METHODS.includes(method as ApiMethod) || method === 'importExport') {
  console.error(`Usage: npm run query -- <method> [args]\nMethods: ${API_METHODS.filter((m) => m !== 'importExport').join(', ')}`)
  process.exit(1)
}

const args = rawArgs.map((a) => {
  try {
    return JSON.parse(a)
  } catch {
    return a
  }
})

const db = openDatabase(devDbPath())
const api = createApi(db) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
console.log(JSON.stringify(await api[method](...args), null, 2))
db.close()
