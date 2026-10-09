import type { AppStatus } from '@shared/api/status'
import type { Db } from '../db'

export function getStatus(db: Db): AppStatus {
  const w = db
    .prepare('SELECT COUNT(*) AS n, MIN(local_date) AS first, MAX(local_date) AS last FROM workouts')
    .get() as { n: number; first: string | null; last: string | null }
  const imp = db
    .prepare('SELECT imported_at, file_name, export_date FROM imports ORDER BY id DESC LIMIT 1')
    .get() as { imported_at: number; file_name: string; export_date: string | null } | undefined
  return {
    hasData: w.n > 0,
    workoutCount: w.n,
    firstDate: w.first,
    lastDate: w.last,
    lastImport: imp ? { importedAt: imp.imported_at, fileName: imp.file_name, exportDate: imp.export_date } : null
  }
}
