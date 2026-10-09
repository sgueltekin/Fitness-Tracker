import type { Api } from '@shared/api'
import type { ImportProgress, ImportSummary } from '@shared/api/status'
import type { Db } from './db'
import { importHealthExport } from './import'
import { getStatus } from './queries/status'
import { getOverview } from './queries/overview'
import { getRunning } from './queries/running'
import { getActivities, getWorkout, setWorkoutCategory } from './queries/activities'
import { getRoutes } from './queries/routes'
import { getGym } from './queries/gym'
import { getHealth } from './queries/health'

export interface ApiHost {
  /** Asks the user for a zip file; resolves undefined when cancelled. */
  pickExportFile?: () => Promise<string | undefined>
  onImportProgress?: (p: ImportProgress) => void
}

/** The single implementation of the renderer-facing API, shared by the app and the CLI. */
export function createApi(db: Db, host: ApiHost = {}): Api {
  let importing: Promise<ImportSummary> | null = null

  return {
    getStatus: async () => getStatus(db),

    importExport: async (zipPath) => {
      if (importing) throw new Error('An import is already running')
      const path = zipPath ?? (await host.pickExportFile?.())
      if (!path) return null
      importing = importHealthExport(db, path, host.onImportProgress)
      try {
        return await importing
      } finally {
        importing = null
      }
    },

    getOverview: async (range) => getOverview(db, range),
    getRunning: async (range) => getRunning(db, range),
    getActivities: async (query) => getActivities(db, query),
    getWorkout: async (id) => getWorkout(db, id),
    setWorkoutCategory: async (id, category) => setWorkoutCategory(db, id, category),
    getRoutes: async (range) => getRoutes(db, range),
    getGym: async (range) => getGym(db, range),
    getHealth: async (range) => getHealth(db, range)
  }
}
