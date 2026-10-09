import type { RangeKey } from '@shared/dates'
import type { RoutesData } from '@shared/api/routes'
import type { Db } from '../db'

export function getRoutes(_db: Db, _range: RangeKey): RoutesData {
  return { ready: false }
}
