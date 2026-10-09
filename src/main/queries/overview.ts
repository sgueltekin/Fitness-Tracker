import type { RangeKey } from '@shared/dates'
import type { OverviewData } from '@shared/api/overview'
import type { Db } from '../db'

export function getOverview(_db: Db, _range: RangeKey): OverviewData {
  return { ready: false }
}
