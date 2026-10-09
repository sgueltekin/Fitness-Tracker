import type { Ymd } from '../dates'
import type { Category, Sport } from '../domain'

/** One workout as shown in lists and tables across the app. */
export interface WorkoutSummary {
  id: number
  sport: Sport
  /** Category after the user's manual override. */
  category: Category
  /** Display name: Runna's title, or a generated one. */
  name: string
  date: Ymd
  startTs: number
  tzOffsetMin: number
  durationS: number
  distanceM: number | null
  avgHr: number | null
  /** Seconds per km; null without distance and for non-distance sports. */
  paceSPerKm: number | null
  hasRoute: boolean
}
