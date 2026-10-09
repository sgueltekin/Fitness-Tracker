export type Sport = 'run' | 'strength' | 'swim' | 'walk' | 'cycle' | 'other'

/** Session types shown across the app. Runs carry one of the first six; other sports map 1:1. */
export type Category =
  | 'walkrun'
  | 'easy'
  | 'tempo'
  | 'intervals'
  | 'long'
  | 'other'
  | 'strength'
  | 'swim'
  | 'walk'
  | 'cycle'

export type RunCategory = Extract<Category, 'walkrun' | 'easy' | 'tempo' | 'intervals' | 'long' | 'other'>

/** Stacking and legend order. This order is what the colour-blind validation was run on; keep it. */
export const RUN_CATEGORIES: RunCategory[] = ['walkrun', 'easy', 'tempo', 'intervals', 'long', 'other']

/** Categories that make up "training time" on the overview, in stack order. */
export const TRAINING_CATEGORIES: Category[] = ['walkrun', 'easy', 'tempo', 'intervals', 'long', 'strength', 'other']

export const CATEGORY_LABEL: Record<Category, string> = {
  walkrun: 'Walk-run',
  easy: 'Easy run',
  tempo: 'Tempo',
  intervals: 'Intervals',
  long: 'Long run',
  other: 'Other',
  strength: 'Gym',
  swim: 'Swim',
  walk: 'Walk',
  cycle: 'Ride'
}

export const SPORT_LABEL: Record<Sport, string> = {
  run: 'Run',
  strength: 'Gym',
  swim: 'Swim',
  walk: 'Walk',
  cycle: 'Ride',
  other: 'Other'
}

/** HealthKit activity type (prefix stripped, e.g. 'Running') to sport. */
export function sportFromActivityType(activityType: string): Sport {
  switch (activityType) {
    case 'Running':
      return 'run'
    case 'TraditionalStrengthTraining':
    case 'FunctionalStrengthTraining':
    case 'CoreTraining':
    case 'HighIntensityIntervalTraining':
      return 'strength'
    case 'Swimming':
      return 'swim'
    case 'Walking':
    case 'Hiking':
      return 'walk'
    case 'Cycling':
      return 'cycle'
    default:
      return 'other'
  }
}

/**
 * Run category from the title Runna writes into Health (HKWorkoutBrandName).
 * Titles follow the phone's language, so German and English are both matched.
 * Order matters: "6,5 km Progressiv Wiederholung Langer Lauf" is a long run.
 */
export function categorizeRun(title: string | null | undefined): RunCategory {
  if (!title) return 'other'
  const t = title.toLowerCase()
  if (/walk-lauf|walk.run|koppeltraining|run.walk/.test(t)) return 'walkrun'
  if (/langer lauf|long run/.test(t)) return 'long'
  if (/wiederholung|intervall|gestückelte|repeats|intervals|fartlek|hügel|hill/.test(t)) return 'intervals'
  if (/progressiv|tempo|wettkampf|schwelle|progression|threshold|race pace/.test(t)) return 'tempo'
  if (/dauerlauf|kontinuierlicher|locker|erholung|easy|recovery|steady/.test(t)) return 'easy'
  return 'other'
}

/** Default category for a workout of any sport. */
export function defaultCategory(sport: Sport, title: string | null | undefined): Category {
  return sport === 'run' ? categorizeRun(title) : sport
}

/** Distances for personal bests, in metres. */
export const BEST_EFFORT_DISTANCES = [1000, 5000, 10000, 21097] as const

export const BEST_EFFORT_LABEL: Record<number, string> = {
  1000: '1 km',
  5000: '5 km',
  10000: '10 km',
  21097: 'Half marathon'
}

/** Display name: Runna's title as written, or a generated one for untitled workouts. */
export function workoutName(w: { title: string | null; sport: Sport; category: Category }): string {
  if (w.title) return w.title
  switch (w.sport) {
    case 'run':
      return w.category === 'other' ? 'Run' : CATEGORY_LABEL[w.category]
    case 'strength':
      return 'Gym session'
    case 'swim':
      return 'Swim'
    case 'walk':
      return 'Walk'
    case 'cycle':
      return 'Ride'
    default:
      return 'Workout'
  }
}

/**
 * Some logging apps write a token energy value of a few kcal for a session of an hour or more.
 * Below this rate the number is not a measurement and is treated as missing.
 */
export const MIN_KCAL_PER_MIN = 0.5

/** Active energy of a workout, or null when it is missing or too low to be a measurement. */
export function measuredEnergyKcal(energyKcal: number | null | undefined, durationS: number): number | null {
  if (energyKcal == null || durationS <= 0) return null
  return energyKcal / (durationS / 60) >= MIN_KCAL_PER_MIN ? energyKcal : null
}
