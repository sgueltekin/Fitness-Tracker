import type { RangeKey } from '@shared/dates'
import type { RunningData } from '@shared/api/running'
import type { Db } from '../db'

export function getRunning(_db: Db, _range: RangeKey): RunningData {
  return { ready: false }
}
