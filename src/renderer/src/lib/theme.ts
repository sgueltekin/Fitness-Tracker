import { useSyncExternalStore } from 'react'
import type { Category } from '@shared/domain'

/** Resolved colour values for code that cannot use CSS variables (ECharts, MapLibre). */
export interface Tokens {
  dark: boolean
  fontFamily: string
  page: string
  surface: string
  sunk: string
  ink: string
  ink2: string
  muted: string
  grid: string
  axis: string
  line: string
  ctx: string
  up: string
  down: string
  cat: Record<Category, string>
  /** Sequential ramp, low to high (4 steps). */
  seq: string[]
  /** Heart-rate zones 1 to 5. */
  zone: string[]
}

const CATEGORIES: Category[] = ['walkrun', 'easy', 'tempo', 'intervals', 'long', 'other', 'strength', 'swim', 'walk', 'cycle']

const media = window.matchMedia('(prefers-color-scheme: dark)')
let cache: Tokens | null = null

function read(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string): string => cs.getPropertyValue(name).trim()
  return {
    dark: media.matches,
    fontFamily: "'Barlow', 'Segoe UI', system-ui, sans-serif",
    page: v('--page'),
    surface: v('--surface'),
    sunk: v('--sunk'),
    ink: v('--ink'),
    ink2: v('--ink2'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    line: v('--line'),
    ctx: v('--ctx'),
    up: v('--up'),
    down: v('--down'),
    cat: Object.fromEntries(CATEGORIES.map((c) => [c, v(`--cat-${c}`)])) as Record<Category, string>,
    seq: [1, 2, 3, 4].map((i) => v(`--seq-${i}`)),
    zone: [1, 2, 3, 4, 5].map((i) => v(`--zone-${i}`))
  }
}

function subscribe(onChange: () => void): () => void {
  const handler = (): void => {
    cache = null
    onChange()
  }
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

function snapshot(): Tokens {
  if (!cache || cache.dark !== media.matches) cache = read()
  return cache
}

/** Current theme colours; re-renders when the system switches between light and dark. */
export function useTokens(): Tokens {
  return useSyncExternalStore(subscribe, snapshot)
}

/** CSS variable reference for a category colour, for use in inline styles. */
export function catVar(category: Category): string {
  return `var(--cat-${category})`
}
