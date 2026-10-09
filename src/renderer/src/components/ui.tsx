import type { ReactNode } from 'react'
import { CATEGORY_LABEL, type Category } from '@shared/domain'
import { RANGE_OPTIONS } from '@shared/dates'
import { useAppState } from '@/lib/app-state'
import { catVar } from '@/lib/theme'

/** Page title row. `right` defaults to the shared date-range control; pass null to hide it. */
export function PageHeader({
  title,
  subtitle,
  right
}: {
  title: string
  subtitle?: ReactNode
  right?: ReactNode | null
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 text-[28px] font-semibold leading-tight">{title}</h1>
        {subtitle != null && <div className="text-ink2">{subtitle}</div>}
      </div>
      {right === undefined ? <RangeControl /> : right}
    </header>
  )
}

/** Surface panel. With `title` it renders the standard card heading. */
export function Card({
  title,
  subtitle,
  action,
  className = '',
  children
}: {
  title?: string
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3.5 rounded-xl border border-line bg-surface p-5 ${className}`}>
      {title && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="m-0 text-base font-semibold">{title}</h2>
            {subtitle != null && <div className="text-[13px] text-ink2">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export type Tone = 'good' | 'bad' | 'neutral'

const TONE_CLASS: Record<Tone, string> = { good: 'text-up', bad: 'text-down', neutral: 'text-ink2' }

/**
 * Headline number with an optional change line and a mini bar trend.
 * `delta.tone` says whether the change is good, not which way it points:
 * a lower resting heart rate is 'good' with a down arrow in the text.
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  sub,
  spark
}: {
  label: string
  value: ReactNode
  unit?: string
  delta?: { text: string; tone: Tone } | null
  sub?: ReactNode
  /** Values oldest to newest; the last bar is emphasised. */
  spark?: number[]
}) {
  return (
    <div className="flex min-w-0 flex-1 basis-[200px] flex-col gap-1 rounded-xl border border-line bg-surface px-[18px] py-4">
      <div className="text-[13px] text-ink2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[32px] font-semibold leading-[1.15]">{value}</span>
        {unit && <span className="text-[15px] text-ink2">{unit}</span>}
      </div>
      {(delta || sub != null) && (
        <div className="text-[13px] text-ink2">
          {delta && <span className={`font-semibold ${TONE_CLASS[delta.tone]}`}>{delta.text}</span>}
          {delta && sub != null && ' '}
          {sub}
        </div>
      )}
      {spark && spark.length > 0 && <SparkBars values={spark} />}
    </div>
  )
}

export function SparkBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 0)
  return (
    <div className="mt-2 flex h-7 items-end gap-[3px]" aria-hidden="true">
      {values.map((v, i) => (
        <div
          key={i}
          className="max-w-3.5 flex-1 rounded-t-sm"
          style={{
            height: max > 0 ? Math.max(2, Math.round((v / max) * 28)) : 2,
            background: i === values.length - 1 ? 'var(--ink)' : 'var(--ctx)'
          }}
        />
      ))}
    </div>
  )
}

/** Square colour key. Identity is carried by the swatch; the label stays in text colour. */
export function Swatch({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-[3px]" style={{ width: size, height: size, background: color }} />
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <Swatch color={it.color} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export function CategoryTag({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink2">
      <Swatch color={catVar(category)} />
      {CATEGORY_LABEL[category]}
    </span>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: { key: T; label: string }[]
  value: T
  onChange(key: T): void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]">
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={`min-h-9 rounded-[7px] border-0 px-3.5 ${
              active ? 'bg-sunk font-semibold text-ink' : 'bg-transparent font-medium text-ink2 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The date-range filter shared by all pages. */
export function RangeControl() {
  const { range, setRange } = useAppState()
  return <Segmented label="Date range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
}

/** Shown inside a card or page when there is nothing to draw. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <div className="font-semibold">{title}</div>
      {children != null && <div className="max-w-md text-[13px] text-ink2">{children}</div>}
    </div>
  )
}

/** Standard handling for a page's loading and error states; renders children once data is there. */
export function PageState({
  loading,
  error,
  hasData,
  children
}: {
  loading: boolean
  error: string | null
  hasData: boolean
  children: ReactNode
}) {
  if (error) return <EmptyState title="Could not load this page">{error}</EmptyState>
  if (!hasData) return loading ? <div className="py-10 text-center text-ink2">Loading…</div> : null
  return <div className={loading ? 'flex flex-col gap-5 opacity-60 transition-opacity' : 'flex flex-col gap-5'}>{children}</div>
}
