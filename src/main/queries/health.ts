import type { RangeKey } from '@shared/dates'
import type { HealthData } from '@shared/api/health'
import type { Db } from '../db'

export function getHealth(_db: Db, _range: RangeKey): HealthData {
  return { ready: false }
}
