import type { RangeKey } from '@shared/dates'
import type { GymData } from '@shared/api/gym'
import type { Db } from '../db'

export function getGym(_db: Db, _range: RangeKey): GymData {
  return { ready: false }
}
