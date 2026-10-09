import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import type { HrZone, WorkoutDetail as Detail, WorkoutSegment } from '@shared/api/activities'
import { CATEGORY_LABEL, RUN_CATEGORIES, type Category, type RunCategory } from '@shared/domain'
import { fmtClock, fmtDateLong, fmtDuration, fmtKm, fmtNumber, fmtPace } from '@shared/format'
import { Chart } from '@/components/Chart'
import { MapView, type MapLine, type MapMarker } from '@/components/MapView'
import { Card, CategoryTag, EmptyState, PageState, Segmented, StatTile, Swatch } from '@/components/ui'
import { baseOption, categoryAxis, lineSeries, tipRow, valueAxis } from '@/lib/charts'
import { catVar, useTokens, type Tokens } from '@/lib/theme'
import { useApi } from '@/lib/useApi'

const CHART_HEIGHT = 200
const OUTLINE_BUTTON = 'min-h-11 rounded-[10px] border border-axis bg-surface px-[18px] font-semibold text-ink disabled:opacity-60'

/**
 * Colour of this workout's route and chart marks: its session-type colour. 'Other' and 'Walk' are
 * context greys that vanish on a map, so those workouts draw in secondary ink instead.
 */
function markColor(t: Tokens, category: Category): string {
  return category === 'other' || category === 'walk' ? t.ink2 : t.cat[category]
}

// ---------------------------------------------------------------------------------------------
// Header

/** Goes back to the page the user came from; opened directly, there is none, so it offers the list. */
function BackLink() {
  const location = useLocation()
  const navigate = useNavigate()
  const cls = 'inline-flex min-h-11 items-center border-0 bg-transparent p-0 text-[13px] font-semibold text-ink2 no-underline hover:text-ink'
  // React Router gives the first entry of a session the key 'default'.
  if (location.key === 'default') {
    return (
      <Link to="/activities" className={cls}>
        ← All activities
      </Link>
    )
  }
  return (
    <button type="button" onClick={() => navigate(-1)} className={cls}>
      ← Back
    </button>
  )
}

/** Button with a menu of run types. Picking the detected type clears the manual override. */
function TypeMenu({
  current,
  detected,
  busy,
  onPick
}: {
  current: Category
  detected: Category
  busy: boolean
  onPick(category: RunCategory | null): void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    const start = RUN_CATEGORIES.findIndex((c) => c === current)
    items.current[Math.max(0, start)]?.focus()
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, current])

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      setOpen(false)
      trigger.current?.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = RUN_CATEGORIES.length
      const at = items.current.findIndex((el) => el === document.activeElement)
      items.current[(at + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n]?.focus()
    }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className={OUTLINE_BUTTON}
      >
        Change workout type
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Workout type"
          className="absolute right-0 top-full z-20 mt-1.5 flex w-60 flex-col rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          {RUN_CATEGORIES.map((c, i) => (
            <button
              key={c}
              ref={(el) => {
                items.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={c === current}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
                if (c !== current) onPick(c === detected ? null : c)
              }}
              className={`flex min-h-10 items-center gap-2 rounded-lg border-0 px-2.5 text-left text-ink hover:bg-sunk ${
                c === current ? 'bg-sunk font-semibold' : 'bg-transparent'
              }`}
            >
              <Swatch color={catVar(c)} />
              <span className="flex-1">{CATEGORY_LABEL[c]}</span>
              {c === detected && <span className="text-[13px] font-normal text-ink2">Detected</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Header({ d, busy, saveError, onPick }: { d: Detail; busy: boolean; saveError: string | null; onPick(c: RunCategory | null): void }) {
  const s = d.summary
  const origin = d.userEntered ? `Entered by hand in ${d.source}` : `Recorded with ${d.source}`
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <BackLink />
        <h1 className="m-0 text-[28px] font-semibold leading-tight">{s.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-ink2">
          <CategoryTag category={s.category} />
          {d.categoryOverridden && (
            <span className="inline-flex items-center gap-2">
              Type set by hand
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(null)}
                className="min-h-8 rounded-lg border border-axis bg-surface px-2.5 text-[13px] font-semibold text-ink disabled:opacity-60"
              >
                Reset to {CATEGORY_LABEL[d.autoCategory]}
              </button>
            </span>
          )}
          <span>
            {fmtDateLong(s.date)}, {fmtClock(s.startTs, s.tzOffsetMin)}
          </span>
          <span>
            {origin}
            {d.indoor ? ' · Indoor' : ''}
          </span>
        </div>
      </div>
      {d.categoryEditable && (
        <div className="ml-auto flex flex-col items-end gap-1">
          <TypeMenu current={s.category} detected={d.autoCategory} busy={busy} onPick={onPick} />
          {saveError && (
            <div role="alert" className="text-[13px] text-down">
              Could not save the type: {saveError}
            </div>
          )}
        </div>
      )}
    </header>
  )
}

// ---------------------------------------------------------------------------------------------
// Numbers

interface Stat {
  label: string
  value: string
  unit?: string
  sub?: string
}

/** The numbers that describe the whole session, most important first; only those that were recorded. */
function headlineStats(d: Detail): Stat[] {
  const s = d.summary
  const out: Stat[] = []
  if (s.distanceM) {
    out.push(
      s.sport === 'swim'
        ? { label: 'Distance', value: fmtNumber(s.distanceM), unit: 'm' }
        : { label: 'Distance', value: fmtKm(s.distanceM, 2), unit: 'km' }
    )
  }
  out.push({
    label: 'Time',
    value: fmtDuration(s.durationS),
    sub: d.elapsedS - s.durationS >= 10 ? `Elapsed ${fmtDuration(d.elapsedS)}` : undefined
  })
  if (s.paceSPerKm) {
    out.push({ label: 'Avg pace', value: fmtPace(s.paceSPerKm), unit: '/km', sub: d.bestKmS ? `Fastest km ${fmtPace(d.bestKmS)}` : undefined })
  } else if (s.distanceM && s.sport === 'swim') {
    out.push({ label: 'Avg pace', value: fmtPace(s.durationS / (s.distanceM / 100)), unit: '/100 m' })
  } else if (s.distanceM && s.durationS > 0) {
    out.push({ label: 'Avg speed', value: fmtNumber((s.distanceM / s.durationS) * 3.6, 1), unit: 'km/h' })
  }
  if (s.avgHr) {
    out.push({
      label: 'Avg heart rate',
      value: fmtNumber(s.avgHr),
      unit: 'bpm',
      sub: d.maxHr ? `Max ${fmtNumber(d.maxHr)} bpm` : undefined
    })
  }
  if (d.elevationGainM != null) out.push({ label: 'Elevation gain', value: fmtNumber(d.elevationGainM), unit: 'm' })
  if (d.energyKcal) out.push({ label: 'Active energy', value: fmtNumber(d.energyKcal), unit: 'kcal' })
  if (d.effort) out.push({ label: 'Effort', value: fmtNumber(d.effort), unit: 'of 10', sub: 'Apple effort score' })
  return out
}

function formStats(d: Detail): Stat[] {
  const out: Stat[] = []
  if (d.avgPowerW) out.push({ label: 'Avg power', value: fmtNumber(d.avgPowerW), unit: 'W' })
  if (d.cadenceSpm) out.push({ label: 'Cadence', value: fmtNumber(d.cadenceSpm), unit: 'steps/min' })
  if (d.avgStrideM) out.push({ label: 'Stride length', value: fmtNumber(d.avgStrideM, 2), unit: 'm' })
  if (d.avgGctMs) out.push({ label: 'Ground contact', value: fmtNumber(d.avgGctMs), unit: 'ms' })
  if (d.avgVertOscCm) out.push({ label: 'Vertical oscillation', value: fmtNumber(d.avgVertOscCm, 1), unit: 'cm' })
  if (d.stepCount) out.push({ label: 'Steps', value: fmtNumber(d.stepCount) })
  return out
}

function Metric({ stat }: { stat: Stat }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink2">{stat.label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold leading-tight">{stat.value}</span>
        {stat.unit && <span className="text-ink2">{stat.unit}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Laps and splits

type SegmentMode = 'laps' | 'splits'

function SegmentTable({ segments, mode }: { segments: WorkoutSegment[]; mode: SegmentMode }) {
  const withHr = segments.some((s) => s.avgHr != null)
  const cols = withHr ? 'grid grid-cols-[44px_repeat(4,minmax(0,1fr))] gap-2' : 'grid grid-cols-[44px_repeat(3,minmax(0,1fr))] gap-2'
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[320px]" role="table" aria-label={mode === 'laps' ? 'Laps' : 'Kilometre splits'}>
        <div role="row" className={`${cols} border-b border-axis py-2 text-xs text-muted`}>
          <div role="columnheader">{mode === 'laps' ? 'Lap' : 'Km'}</div>
          <div role="columnheader" className="text-right">Distance</div>
          <div role="columnheader" className="text-right">Time</div>
          <div role="columnheader" className="text-right">Pace</div>
          {withHr && <div role="columnheader" className="text-right">Avg HR</div>}
        </div>
        {segments.map((s) => (
          <div key={s.idx} role="row" className={`${cols} tnum min-h-10 items-center border-b border-grid`}>
            <div role="cell" className="font-semibold">{s.idx}</div>
            <div role="cell" className="text-right text-ink2">{s.distanceM != null ? `${fmtKm(s.distanceM, 2)} km` : '–'}</div>
            <div role="cell" className="text-right">{fmtDuration(s.durationS)}</div>
            <div role="cell" className="text-right">{s.paceSPerKm ? `${fmtPace(s.paceSPerKm)} /km` : '–'}</div>
            {withHr && <div role="cell" className="text-right text-ink2">{s.avgHr != null ? Math.round(s.avgHr) : '–'}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The segments that get a point in the pace chart. Left out: segments without a pace (the seconds
 * between the last lap and the stop button) and the stub of a last kilometre, whose pace over a
 * few dozen metres would count as much as a whole kilometre's. The table still lists them.
 */
function chartedSegments(segments: WorkoutSegment[], mode: SegmentMode): WorkoutSegment[] {
  return segments.filter((s, i) => {
    if (!s.paceSPerKm) return false
    return !(mode === 'splits' && i === segments.length - 1 && (s.distanceM ?? 0) < 200)
  })
}

/** Pace axis steps in s/km, finest first. */
const PACE_STEPS = [15, 30, 60, 120, 300, 600]

/**
 * One dot per lap or kilometre on an inverted pace axis, so faster sits higher. The axis spans
 * round paces around the data rather than starting at zero; that is why the marks are dots on a
 * line and not columns, whose length would then mean nothing.
 */
function paceOption(t: Tokens, segments: WorkoutSegment[], mode: SegmentMode, color: string): EChartsOption {
  const paces = segments.map((s) => s.paceSPerKm as number)
  const fastest = Math.min(...paces)
  const slowest = Math.max(...paces)
  const step = PACE_STEPS.find((st) => Math.ceil(slowest / st) - Math.floor(fastest / st) <= 4) ?? PACE_STEPS[PACE_STEPS.length - 1]
  let min = Math.floor(fastest / step) * step
  let max = Math.ceil(slowest / step) * step
  if (min === fastest) min -= step
  if (max === slowest) max += step
  const unit = mode === 'laps' ? 'Lap' : 'Km'

  return {
    ...baseOption(t),
    tooltip: {
      ...baseOption(t).tooltip,
      formatter: (params: unknown) => {
        const s = segments[(params as { dataIndex: number }[])[0].dataIndex]
        const facts = [s.distanceM != null ? `${fmtKm(s.distanceM, 2)} km` : null, fmtDuration(s.durationS), s.avgHr != null ? `${Math.round(s.avgHr)} bpm` : null]
        return (
          `<div style="font-weight:600;margin-bottom:4px">${unit} ${s.idx}</div>` +
          tipRow(color, 'Pace', `${fmtPace(s.paceSPerKm)} /km`) +
          `<div style="color:${t.ink2}">${facts.filter(Boolean).join(' · ')}</div>`
        )
      }
    },
    xAxis: categoryAxis(t, segments.map((s) => String(s.idx))),
    yAxis: valueAxis(t, {
      inverse: true,
      min,
      max,
      interval: step,
      axisLabel: { color: t.muted, fontSize: 12, formatter: (v: number) => fmtPace(v) }
    }),
    series: lineSeries(t, 'Pace', color, paces, { symbols: true, endDot: false })
  }
}

// ---------------------------------------------------------------------------------------------
// Time series

/** Axis bounds on round numbers with at most four intervals, spanning at least `minSpan`. */
function niceBounds(lo: number, hi: number, minSpan: number): { min: number; max: number; interval: number } {
  const span = Math.max(hi - lo, minSpan)
  const interval = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((i) => span / i <= 3) ?? 2000
  const min = Math.floor(lo / interval) * interval
  const max = Math.max(Math.ceil(hi / interval) * interval, min + Math.ceil(minSpan / interval) * interval)
  return { min, max, interval }
}

/** One measure over the elapsed time of the workout. `values[i]` belongs to second `i * stepS`. */
function timeSeriesOption(
  t: Tokens,
  values: (number | null)[],
  stepS: number,
  opts: { name: string; color: string; unit: string; digits?: number; minSpan: number; area?: boolean }
): EChartsOption {
  const known = values.filter((v): v is number => v != null)
  const bounds = niceBounds(Math.min(...known), Math.max(...known), opts.minSpan)
  const elapsed = (values.length - 1) * stepS
  const tick = [60, 120, 300, 600, 900, 1200, 1800, 3600].find((s) => elapsed / s <= 6) ?? 7200
  // A workout has no "latest" value, so the end dot lineSeries adds would only mislead.
  const series = [lineSeries(t, opts.name, opts.color, values, { area: opts.area })].flat().map((s) => ({ ...s, markPoint: undefined }))

  return {
    ...baseOption(t),
    tooltip: {
      ...baseOption(t).tooltip,
      formatter: (params: unknown) => {
        const p = (params as { axisValue: string; value: number | null }[])[0]
        const row = p.value == null ? `<div style="color:${t.ink2}">Not recorded</div>` : tipRow(opts.color, opts.name, `${fmtNumber(p.value, opts.digits ?? 0)} ${opts.unit}`)
        return `<div style="font-weight:600;margin-bottom:4px">${p.axisValue} elapsed</div>${row}`
      }
    },
    xAxis: categoryAxis(t, values.map((_, i) => fmtDuration(i * stepS)), {
      boundaryGap: false,
      axisLabel: { color: t.muted, fontSize: 12, interval: (i: number) => (i * stepS) % tick === 0 }
    }),
    yAxis: valueAxis(t, bounds),
    series
  } as EChartsOption
}

// ---------------------------------------------------------------------------------------------
// Heart-rate zones

function zoneRange(z: HrZone): string {
  if (z.minBpm == null && z.maxBpm != null) return `under ${Math.round(z.maxBpm)} bpm`
  if (z.maxBpm == null && z.minBpm != null) return `${Math.round(z.minBpm)} bpm and up`
  if (z.minBpm != null && z.maxBpm != null) return `${Math.round(z.minBpm)}–${Math.round(z.maxBpm)} bpm`
  return ''
}

/** Share of the session spent in each zone, hardest zone on top. Every value is printed, so it needs no tooltip. */
function ZoneBars({ zones }: { zones: HrZone[] }) {
  const total = zones.reduce((sum, z) => sum + z.seconds, 0)
  return (
    <div className="flex flex-col gap-3" role="table" aria-label="Time in heart-rate zones">
      {[...zones].reverse().map((z) => {
        const share = total > 0 ? z.seconds / total : 0
        return (
          <div key={z.zone} role="row" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <div role="cell" className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Swatch color={`var(--zone-${z.zone})`} />
                Zone {z.zone}
              </span>
              <span className="text-[13px] text-ink2">{zoneRange(z)}</span>
            </div>
            <div role="cell" className="tnum text-right">
              <span className="font-semibold">{fmtDuration(z.seconds)}</span>
              <span className="inline-block w-11 text-ink2">{Math.round(share * 100)}%</span>
            </div>
            <div className="col-span-2 h-2.5 overflow-hidden rounded-sm bg-sunk" aria-hidden="true">
              <div className="h-full rounded-sm" style={{ width: `${share * 100}%`, background: `var(--zone-${z.zone})` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Page

function Body({ d, onChanged }: { d: Detail; onChanged(): void }) {
  const t = useTokens()
  const s = d.summary
  const color = markColor(t, s.category)

  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  async function pick(category: RunCategory | null): Promise<void> {
    setBusy(true)
    setSaveError(null)
    try {
      await window.api.setWorkoutCategory(s.id, category)
      onChanged()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const [wanted, setWanted] = useState<SegmentMode>('laps')
  const mode: SegmentMode = d.laps.length === 0 ? 'splits' : d.splits.length === 0 ? 'laps' : wanted
  const segments = mode === 'laps' ? d.laps : d.splits
  const charted = useMemo(() => chartedSegments(segments, mode), [segments, mode])

  // Memoised so MapView does not redraw on every render.
  const hasRoute = d.route.length > 1
  const lines = useMemo<MapLine[]>(() => [{ id: s.id, coords: d.route, color }], [s.id, d.route, color])
  const markers = useMemo<MapMarker[]>(
    () => (d.route.length > 1 ? [{ coord: d.route[0], kind: 'start' }, { coord: d.route[d.route.length - 1], kind: 'end' }] : []),
    [d.route]
  )

  const { stepS, hr, powerW, elevationM } = d.series
  const paceChart = useMemo(() => (charted.length > 0 ? paceOption(t, charted, mode, color) : null), [t, charted, mode, color])
  const hrChart = useMemo(
    () => (hr ? timeSeriesOption(t, hr, stepS, { name: 'Heart rate', color, unit: 'bpm', minSpan: 30 }) : null),
    [t, hr, stepS, color]
  )
  const powerChart = useMemo(
    () => (powerW ? timeSeriesOption(t, powerW, stepS, { name: 'Power', color, unit: 'W', minSpan: 60 }) : null),
    [t, powerW, stepS, color]
  )
  const elevationChart = useMemo(
    () => (elevationM ? timeSeriesOption(t, elevationM, stepS, { name: 'Elevation', color, unit: 'm', digits: 1, minSpan: 30, area: true }) : null),
    [t, elevationM, stepS, color]
  )

  const all = headlineStats(d)
  const headline = all.slice(0, 5)
  const more = [...all.slice(5), ...formStats(d)]
  const noHeartRate = !s.avgHr && !hr && d.zones.length === 0

  const segmentCard = segments.length > 0 && (
    <Card
      title={mode === 'laps' ? 'Laps' : 'Kilometre splits'}
      subtitle={mode === 'laps' ? `As recorded by ${d.source}` : undefined}
      className="flex-[2] basis-[340px]"
      action={
        d.laps.length > 0 && d.splits.length > 0 ? (
          <Segmented<SegmentMode>
            label="Break the workout down by"
            options={[
              { key: 'laps', label: 'Laps' },
              { key: 'splits', label: 'Per km' }
            ]}
            value={mode}
            onChange={setWanted}
          />
        ) : undefined
      }
    >
      <SegmentTable segments={segments} mode={mode} />
    </Card>
  )

  const cards: ReactNode[] = []
  if (paceChart) {
    cards.push(
      <Card key="pace" title={mode === 'laps' ? 'Pace by lap' : 'Pace by kilometre'} subtitle="Minutes per kilometre · faster is higher" className="flex-1 basis-[440px]">
        <Chart
          option={paceChart}
          height={CHART_HEIGHT}
          ariaLabel={`Line chart of the pace of each ${mode === 'laps' ? 'lap' : 'kilometre'}; higher points are faster`}
        />
      </Card>
    )
  }
  if (hrChart) {
    cards.push(
      <Card
        key="hr"
        title="Heart rate"
        subtitle={`Beats per minute over elapsed time${d.maxHr ? ` · max ${fmtNumber(d.maxHr)}` : ''}`}
        className="flex-1 basis-[440px]"
      >
        <Chart option={hrChart} height={CHART_HEIGHT} ariaLabel="Line chart of heart rate in beats per minute over the elapsed time of the workout" />
      </Card>
    )
  } else if (noHeartRate) {
    cards.push(
      <Card key="hr" title="Heart rate" className="flex-1 basis-[440px]">
        <EmptyState title="No heart rate recorded">
          {d.userEntered
            ? 'This session was entered by hand, so there are no measurements behind it.'
            : `${s.sport === 'run' ? 'Heart rate, zones and running form' : 'Heart rate and zones'} are only measured by an Apple Watch. This workout was recorded with ${d.source}.`}
        </EmptyState>
      </Card>
    )
  }
  if (d.zones.length > 0) {
    cards.push(
      <Card key="zones" title="Time in heart-rate zones" subtitle="Zones as set on the Apple Watch" className="flex-1 basis-[440px]">
        <ZoneBars zones={d.zones} />
      </Card>
    )
  }
  if (powerChart) {
    cards.push(
      <Card key="power" title="Running power" subtitle={`Watts over elapsed time${d.avgPowerW ? ` · average ${fmtNumber(d.avgPowerW)}` : ''}`} className="flex-1 basis-[440px]">
        <Chart option={powerChart} height={CHART_HEIGHT} ariaLabel="Line chart of running power in watts over the elapsed time of the workout" />
      </Card>
    )
  }
  if (elevationChart) {
    cards.push(
      <Card
        key="elevation"
        title="Elevation"
        subtitle={`Metres above sea level over elapsed time${d.elevationGainM != null ? ` · ${fmtNumber(d.elevationGainM)} m gained` : ''}`}
        className="flex-1 basis-[440px]"
      >
        <Chart option={elevationChart} height={CHART_HEIGHT} ariaLabel="Line chart of the altitude along the route over the elapsed time of the workout" />
      </Card>
    )
  }
  if (more.length > 0) {
    cards.push(
      <Card key="more" title={s.sport === 'run' ? 'Effort and running form' : 'More from this workout'} subtitle="Averages over the whole session" className="flex-1 basis-[440px]">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-4">
          {more.map((m) => (
            <Metric key={m.label} stat={m} />
          ))}
        </div>
      </Card>
    )
  }
  // Without a map the pace chart moves up beside the table it belongs to.
  const paceBesideTable = !hasRoute && segmentCard && paceChart
  const firstRow = paceBesideTable ? cards.shift() : null

  return (
    <>
      <Header d={d} busy={busy} saveError={saveError} onPick={(c) => void pick(c)} />

      <section className="flex flex-wrap gap-4">
        {headline.map((h) => (
          <StatTile key={h.label} label={h.label} value={h.value} unit={h.unit} sub={h.sub} />
        ))}
      </section>

      {(hasRoute || segmentCard) && (
        <section className="flex flex-wrap gap-4">
          {hasRoute && (
            // MapView takes its height from the row, so it grows with a long lap table.
            <div className="relative min-h-[420px] min-w-0 flex-[3] basis-[480px]">
              <div className="absolute inset-0">
                <MapView lines={lines} markers={markers} height="100%" />
              </div>
            </div>
          )}
          {segmentCard}
          {firstRow}
        </section>
      )}

      {cards.length > 0 && <section className="flex flex-wrap gap-4">{cards}</section>}
    </>
  )
}

export default function WorkoutDetail() {
  const params = useParams()
  const id = /^\d+$/.test(params.id ?? '') ? Number(params.id) : null
  // Wrapped in an object so "not found" (workout: null) differs from "not loaded yet" (data: null).
  const { data, loading, error, reload } = useApi(
    async (api) => ({ id, workout: id == null ? null : await api.getWorkout(id) }),
    [id]
  )

  // A list scrolled far down would otherwise open the workout in the middle of the page.
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  // useApi keeps the previous result while it refetches; that would be another workout's.
  const current = data && data.id === id ? data : null

  return (
    <PageState loading={loading} error={error} hasData={current != null}>
      {current &&
        (current.workout ? (
          <Body key={current.workout.summary.id} d={current.workout} onChanged={reload} />
        ) : (
          <>
            <div>
              <BackLink />
            </div>
            <Card>
              <EmptyState title="Workout not found">
                <div>
                  There is no workout with this number. Workouts are renumbered when Health data is imported again, so an old link can stop
                  working.
                </div>
                <Link to="/activities" className={`${OUTLINE_BUTTON} mt-3 inline-flex items-center no-underline`}>
                  All activities
                </Link>
              </EmptyState>
            </Card>
          </>
        ))}
    </PageState>
  )
}
