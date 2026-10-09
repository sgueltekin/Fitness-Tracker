import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { BarSeriesOption, EChartsOption, LineSeriesOption } from 'echarts'
import type { Bucket, EasyTrendPoint, RunningData } from '@shared/api/running'
import { RANGE_OPTIONS, type RangeKey, type Ymd } from '@shared/dates'
import { BEST_EFFORT_LABEL, CATEGORY_LABEL, RUN_CATEGORIES } from '@shared/domain'
import {
  fmtDateShort,
  fmtDateYear,
  fmtDayMonth,
  fmtDuration,
  fmtHoursMin,
  fmtKm,
  fmtMonth,
  fmtNumber,
  fmtPace,
  paceFrom,
  pctChange
} from '@shared/format'
import { Chart } from '@/components/Chart'
import { Card, EmptyState, Legend, PageHeader, PageState, StatTile, type Tone } from '@/components/ui'
import { WorkoutTable } from '@/components/WorkoutTable'
import { useAppState } from '@/lib/app-state'
import { baseOption, categoryAxis, lineSeries, stackedBarSeries, tipRow, valueAxis, type StackKey } from '@/lib/charts'
import { useTokens, type Tokens } from '@/lib/theme'
import { useApi } from '@/lib/useApi'

export default function Running() {
  const { range } = useAppState()
  const { data, loading, error } = useApi((api) => api.getRunning(range), [range])

  return (
    <>
      <PageHeader title="Running" subtitle={data ? <RangeSummary data={data} /> : undefined} />
      <PageState loading={loading} error={error} hasData={data != null}>
        {data && (
          <>
            <Tiles data={data} range={range} />
            <section className="flex flex-wrap gap-4">
              <DistanceCard data={data} />
              <BestsCard data={data} />
            </section>
            <section className="flex flex-wrap gap-4">
              <EasyTrendCard data={data} measure="pace" />
              <EasyTrendCard data={data} measure="hr" />
              <ZonesCard data={data} />
            </section>
            <KeySessionsCard data={data} />
          </>
        )}
      </PageState>
    </>
  )
}

// --- Text helpers ------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

const sameYear = (a: Ymd, b: Ymd): boolean => a.slice(0, 4) === b.slice(0, 4)

const BUCKET_WORDS: Record<Bucket, { per: string; average: string }> = {
  week: { per: 'week', average: 'Weekly average' },
  month: { per: 'month', average: 'Monthly average' },
  quarter: { per: 'quarter', average: 'Quarterly average' }
}

/** 'Week of 4 Mar', 'Mar 2024' or 'Q1 2024'. */
function bucketTitle(start: Ymd, bucket: Bucket): string {
  const year = start.slice(0, 4)
  if (bucket === 'week') return `Week of ${fmtDayMonth(start)}`
  if (bucket === 'month') return `${fmtMonth(start)} ${year}`
  return `Q${(Number(start.slice(5, 7)) + 2) / 3} ${year}`
}

function RangeSummary({ data }: { data: RunningData }) {
  const from = sameYear(data.from, data.to) ? fmtDayMonth(data.from) : fmtDateYear(data.from)
  const totals =
    data.totals.runs > 0 ? `${plural(data.totals.runs, 'run')} · ${fmtKm(data.totals.distanceM)} km` : 'No runs'
  return (
    <>
      {from} to {fmtDateYear(data.to)} · {totals}
    </>
  )
}

// --- Headline tiles ----------------------------------------------------------

type Delta = { text: string; tone: Tone } | null

/**
 * Change line for a tile. A move in the wanted direction is 'good'; the other way stays neutral:
 * a lighter week or a slower easy run is often what the plan asked for, so it is not flagged as bad.
 */
function delta(diff: number, unit: string, words: { down: string; up: string }, goodWhen: 'down' | 'up'): Delta {
  if (diff === 0) return { text: 'No change', tone: 'neutral' }
  const dir = diff < 0 ? 'down' : 'up'
  const amount = `${Math.abs(diff)}${unit}`
  return {
    text: `${dir === 'down' ? '▼' : '▲'} ${words[dir] ? `${amount} ${words[dir]}` : amount}`,
    tone: dir === goodWhen ? 'good' : 'neutral'
  }
}

const MAX_PERCENT_CHANGE = 300

function Tiles({ data, range }: { data: RunningData; range: RangeKey }) {
  const { recent, longest } = data
  const weeks = Math.round(recent.days / 7)
  const span = `${weeks}-week avg`
  const versus = `vs previous ${weeks} weeks`

  const km = recent.weeklyDistanceM
  const kmPct = pctChange(km.now, km.before)
  const pace = recent.easyPaceSPerKm
  const hr = recent.easyHr
  const noEasy = recent.easyRuns === 0 ? `No easy runs in the last ${weeks} weeks` : null

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === range)?.label ?? ''
  const longestWhen = range === 'all' ? 'all time' : `last ${rangeLabel}`

  return (
    <section className="flex flex-wrap gap-4">
      <StatTile
        label={`Weekly distance · ${span}`}
        value={fmtKm(km.now)}
        unit="km"
        delta={
          kmPct == null
            ? null
            : // Against a near-empty baseline a percentage explodes; the plain difference says more.
              Math.abs(kmPct) <= MAX_PERCENT_CHANGE
              ? delta(Math.round(kmPct), '%', { down: '', up: '' }, 'up')
              : delta(Number(((km.now - km.before) / 1000).toFixed(1)), ' km', { down: 'less', up: 'more' }, 'up')
        }
        sub={kmPct == null ? `No runs in the ${weeks} weeks before` : versus}
      />
      <StatTile
        label={`Easy pace · ${span}`}
        value={fmtPace(pace.now)}
        unit={pace.now == null ? undefined : '/km'}
        delta={
          pace.now != null && pace.before != null
            ? delta(Math.round(pace.now) - Math.round(pace.before), ' s', { down: 'faster', up: 'slower' }, 'down')
            : null
        }
        sub={noEasy ?? (pace.before == null ? `${plural(recent.easyRuns, 'easy run')} · none in the ${weeks} weeks before` : versus)}
      />
      <StatTile
        label={`Easy-run heart rate · ${span}`}
        value={hr.now == null ? '–' : Math.round(hr.now)}
        unit={hr.now == null ? undefined : 'bpm'}
        delta={
          hr.now != null && hr.before != null
            ? delta(Math.round(hr.now) - Math.round(hr.before), ' bpm', { down: 'lower', up: 'higher' }, 'down')
            : null
        }
        sub={
          noEasy ??
          (hr.now == null ? 'Easy runs were recorded without a watch' : hr.before == null ? `Nothing to compare in the ${weeks} weeks before` : versus)
        }
      />
      <StatTile
        label={`Longest run · ${longestWhen}`}
        value={longest ? fmtKm(longest.distanceM) : '–'}
        unit={longest ? 'km' : undefined}
        sub={
          longest ? (
            <Link to={`/activities/${longest.id}`} className="text-ink2 no-underline hover:underline">
              {sameYear(longest.date, data.to) ? fmtDateShort(longest.date) : fmtDateYear(longest.date)} · {fmtDuration(longest.durationS)}
            </Link>
          ) : (
            'No runs in this range'
          )
        }
      />
    </section>
  )
}

// --- Chart helpers -----------------------------------------------------------

/** Fills the card's remaining height so an empty card lines up with its neighbour. */
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState title={title}>{children}</EmptyState>
    </div>
  )
}

/**
 * X-axis labels for bucket starts. Shows evenly spaced labels counted back from the newest bucket,
 * so the current one is always named; `maxLabels` is how many short labels ('4 Mar') fit.
 * Quarters name the first quarter of each year by its year instead.
 */
function bucketAxisLabels(starts: Ymd[], bucket: Bucket, maxLabels: number): { labels: string[]; show: (index: number) => boolean } {
  const n = starts.length
  if (bucket === 'quarter') {
    const years = new Set(starts.map((s) => s.slice(0, 4))).size
    const step = Math.max(1, Math.ceil(years / maxLabels))
    const lastYear = Number(starts[n - 1].slice(0, 4))
    return {
      labels: starts.map((s) => s.slice(0, 4)),
      show: (i) => starts[i].slice(5, 7) === '01' && (lastYear - Number(starts[i].slice(0, 4))) % step === 0
    }
  }
  // 'Mar 2024' is wider than '4 Mar', so fewer month labels fit.
  const fit = bucket === 'week' ? maxLabels : Math.max(2, Math.floor(maxLabels * 0.6))
  const step = Math.max(1, Math.ceil(n / fit))
  return {
    labels: starts.map((s) => (bucket === 'week' ? fmtDayMonth(s) : bucketTitle(s, bucket))),
    show: (i) => (n - 1 - i) % step === 0
  }
}

/** Axis limits on round steps around the data, using the smallest step that needs at most four intervals. */
function axisBounds(values: number[], steps: number[]): { min: number; max: number; interval: number } {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  for (const step of steps) {
    let min = Math.floor(lo / step) * step
    let max = Math.ceil(hi / step) * step
    if (min === max) {
      min -= step
      max += step
    }
    if ((max - min) / step <= 4 || step === steps[steps.length - 1]) return { min, max, interval: step }
  }
  return { min: lo, max: hi, interval: hi - lo || 1 }
}

/**
 * Where the value label of a line's last point goes: on the side the line does not arrive from,
 * so the two never cross. `room` is a value just beyond the label, for the axis limits to include.
 */
function endLabelPlacement(known: number[], inverse: boolean): { position: 'top' | 'bottom'; room: number } {
  const last = known[known.length - 1]
  const prev = known[known.length - 2] ?? last
  const arrivesFromAbove = inverse ? prev < last : prev > last
  const pad = (Math.max(...known) - Math.min(...known)) * 0.22
  const towardsTop = inverse ? -pad : pad
  return arrivesFromAbove ? { position: 'bottom', room: last - towardsTop } : { position: 'top', room: last + towardsTop }
}

function tipHeader(text: string): string {
  return `<div style="font-weight:600;margin-bottom:4px">${text}</div>`
}

function tipNote(t: Tokens, text: string): string {
  return `<div style="color:${t.ink2};font-size:12px">${text}</div>`
}

/** Closing row of a tooltip: label left, value right, set off by a hairline. */
function tipTotal(t: Tokens, label: string, value: string): string {
  return (
    `<div style="display:flex;gap:8px;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid ${t.grid}">` +
    `<span style="color:${t.ink2}">${label}</span>` +
    `<span style="font-weight:600;font-variant-numeric:tabular-nums">${value}</span></div>`
  )
}

// --- Distance by workout type ------------------------------------------------

const MAX_LABELLED_COLUMNS = 16

function DistanceCard({ data }: { data: RunningData }) {
  const t = useTokens()
  const { bucket, buckets } = data.distance
  const { per } = BUCKET_WORDS[bucket]

  const keys = useMemo<StackKey[]>(
    () =>
      RUN_CATEGORIES.filter((c) => buckets.some((b) => (b.byCategory[c] ?? 0) > 0)).map((c) => ({
        key: c,
        label: CATEGORY_LABEL[c],
        color: t.cat[c]
      })),
    [buckets, t]
  )

  const option = useMemo<EChartsOption>(() => {
    const n = buckets.length
    const rows = buckets.map((b) => Object.fromEntries(keys.map((k) => [k.key, (b.byCategory[k.key as keyof typeof b.byCategory] ?? 0) / 1000])))
    const totals = rows.map((row) => keys.reduce((sum, k) => sum + (row[k.key] ?? 0), 0))
    // The two newest columns carry their total, so the current state reads without hovering.
    // Only while columns are wide apart: on a crowded axis the labels would run into the neighbours.
    const labelled = (ri: number): boolean => n <= MAX_LABELLED_COLUMNS && ri >= n - 2 && totals[ri] > 0
    const topKey = rows.map((row) => keys.reduce((last, k, ki) => ((row[k.key] ?? 0) > 0 ? ki : last), -1))
    const series = (stackedBarSeries(t, keys, rows) as BarSeriesOption[]).map((s, ki) => ({
      ...s,
      data: (s.data as { value: number; itemStyle: object }[]).map((d, ri) =>
        labelled(ri) && topKey[ri] === ki
          ? {
              ...d,
              label: {
                show: true,
                position: 'top' as const,
                distance: 4,
                color: t.ink2,
                fontSize: 12,
                formatter: `${fmtNumber(totals[ri], totals[ri] < 10 ? 1 : 0)} km`
              }
            }
          : d
      )
    }))
    const axis = bucketAxisLabels(buckets.map((b) => b.start), bucket, 8)
    return {
      ...baseOption(t),
      tooltip: {
        ...baseOption(t).tooltip,
        formatter: (params: unknown) => {
          const b = buckets[(params as { dataIndex: number }[])[0].dataIndex]
          const head = tipHeader(bucketTitle(b.start, bucket))
          if (b.runs === 0) return head + tipNote(t, 'No runs')
          const body = keys
            .filter((k) => (b.byCategory[k.key as keyof typeof b.byCategory] ?? 0) > 0)
            .map((k) => tipRow(k.color, k.label, `${fmtKm(b.byCategory[k.key as keyof typeof b.byCategory])} km`))
            .join('')
          const total = Object.values(b.byCategory).reduce((sum, m) => sum + (m ?? 0), 0)
          return head + body + tipTotal(t, plural(b.runs, 'run'), `${fmtKm(total)} km`)
        }
      },
      xAxis: categoryAxis(t, axis.labels, { axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true, interval: axis.show } }),
      yAxis: valueAxis(t, {
        minInterval: 1,
        axisLabel: { color: t.muted, fontSize: 12, formatter: (v: number) => (v === 0 ? '0' : `${v} km`) }
      }),
      series
    }
  }, [buckets, bucket, keys, t])

  return (
    <Card
      title="Distance by workout type"
      subtitle={`Kilometres per ${per} · workout type from the title Runna gives each run`}
      className="flex-[2] basis-[480px]"
    >
      {keys.length === 0 ? (
        <Empty title="No runs in this range">Pick a longer range to see earlier weeks.</Empty>
      ) : (
        <>
          <Legend items={keys.map((k) => ({ color: k.color, label: k.label }))} />
          <Chart
            option={option}
            height={240}
            ariaLabel={`Stacked columns of running distance per ${per} by workout type: ${plural(buckets.length, per)}, ${fmtKm(data.totals.distanceM)} km in total.`}
          />
        </>
      )}
    </Card>
  )
}

// --- Personal bests ----------------------------------------------------------

const BEST_ROW = 'grid min-h-[52px] grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 border-t border-grid'

function BestsCard({ data }: { data: RunningData }) {
  return (
    <Card title="Personal bests" subtitle="Fastest stretch of each distance inside any run · all time" className="flex-1 basis-[300px]">
      <div className="tnum flex flex-col">
        {data.bests.map((b) => {
          const label = BEST_EFFORT_LABEL[b.distanceM] ?? `${fmtKm(b.distanceM)} km`
          if (b.durationS == null || b.workoutId == null || b.date == null) {
            return (
              <div key={b.distanceM} className={BEST_ROW}>
                <div className="font-semibold">{label}</div>
                <div className="col-span-2 text-right text-[13px] text-ink2">No run this long yet</div>
              </div>
            )
          }
          return (
            <Link key={b.distanceM} to={`/activities/${b.workoutId}`} className={`${BEST_ROW} group text-ink no-underline`}>
              <div>
                <div className="font-semibold group-hover:underline">{label}</div>
                <div className="text-[13px] text-ink2">{fmtDateYear(b.date)}</div>
              </div>
              <div className="text-right text-xl font-semibold">{fmtDuration(b.durationS)}</div>
              <div className="text-right text-[13px] text-ink2">{fmtPace(paceFrom(b.distanceM, b.durationS))} /km</div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

// --- Easy-run pace and heart rate --------------------------------------------

const MEASURES = {
  pace: {
    title: 'Easy-run pace',
    name: 'Easy pace',
    value: (p: EasyTrendPoint) => p.paceSPerKm,
    runs: (p: EasyTrendPoint) => p.runs,
    format: (v: number) => `${fmtPace(v)} /km`,
    tick: (v: number) => fmtPace(v),
    steps: [15, 30, 60, 120, 300]
  },
  hr: {
    title: 'Easy-run heart rate',
    name: 'Easy-run heart rate',
    value: (p: EasyTrendPoint) => p.avgHr,
    runs: (p: EasyTrendPoint) => p.hrRuns,
    format: (v: number) => `${Math.round(v)} bpm`,
    tick: (v: number) => String(v),
    steps: [5, 10, 20, 40]
  }
}

function EasyTrendCard({ data, measure }: { data: RunningData; measure: keyof typeof MEASURES }) {
  const t = useTokens()
  const m = MEASURES[measure]
  const { bucket, points } = data.easyTrend
  const { per, average } = BUCKET_WORDS[bucket]

  const values = useMemo(() => points.map((p) => m.value(p)), [points, m])
  const known = useMemo(() => values.filter((v): v is number => v != null), [values])
  const easyRuns = points.reduce((sum, p) => sum + p.runs, 0)
  const hrRuns = points.reduce((sum, p) => sum + p.hrRuns, 0)

  const option = useMemo<EChartsOption | null>(() => {
    if (known.length < 2) return null
    const axis = bucketAxisLabels(points.map((p) => p.start), bucket, 5)
    const inverse = measure === 'pace'
    const last = known[known.length - 1]
    const end = endLabelPlacement(known, inverse)
    // Buckets without an easy run are bridged by the line; the dots show where the measurements are.
    const series = (lineSeries(t, m.name, t.cat.easy, values, { endLabel: m.format(last), connectNulls: true }) as LineSeriesOption[]).map(
      (s) => ({
        ...s,
        showSymbol: true,
        symbolSize: 7,
        markPoint: s.markPoint && { ...s.markPoint, label: { ...s.markPoint.label, position: end.position } }
      })
    )
    return {
      ...baseOption(t),
      // Room on the right for half of the newest x-axis label, which is centred on the last point.
      grid: { left: 4, right: 20, top: 18, bottom: 2, containLabel: true },
      tooltip: {
        ...baseOption(t).tooltip,
        formatter: (params: unknown) => {
          const i = (params as { dataIndex: number }[])[0].dataIndex
          const v = values[i]
          const head = tipHeader(bucketTitle(points[i].start, bucket))
          if (v == null) return head + tipNote(t, points[i].runs > 0 ? 'Easy run without heart rate' : 'No easy run')
          return head + tipRow(t.cat.easy, m.name, m.format(v)) + tipNote(t, plural(m.runs(points[i]), 'easy run'))
        }
      },
      xAxis: categoryAxis(t, axis.labels, {
        boundaryGap: false,
        axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true, interval: axis.show }
      }),
      yAxis: valueAxis(t, {
        ...axisBounds([...known, end.room], m.steps),
        // Pace: smaller is faster, so the axis is inverted to put faster at the top.
        inverse,
        axisLabel: { color: t.muted, fontSize: 12, formatter: m.tick }
      }),
      series
    }
  }, [values, known, points, bucket, m, measure, t])

  const subtitle =
    measure === 'pace'
      ? `${average} in min/km · faster is higher`
      : hrRuns < easyRuns
        ? `${average} in bpm · ${hrRuns} of ${plural(easyRuns, 'easy run')} recorded with a watch`
        : `${average} in bpm · same runs, same ${per}s`

  let body: ReactNode
  if (option) {
    body = (
      // Pinned to the card's bottom edge so the two trend charts line up whatever their subtitles wrap to.
      <div className="mt-auto">
        <Chart
          option={option}
          height={240}
          ariaLabel={`Line chart of ${m.name.toLowerCase()} per ${per} over ${plural(known.length, per)} with easy runs; latest ${m.format(known[known.length - 1])}.`}
        />
      </div>
    )
  } else if (easyRuns === 0) {
    body = <Empty title="No easy runs in this range">Runs that Runna titles as easy or steady runs are tracked here.</Empty>
  } else if (known.length === 0) {
    body = <Empty title="No heart rate on easy runs in this range">Heart rate is only recorded on runs tracked with an Apple Watch.</Empty>
  } else {
    const i = values.findIndex((v) => v != null)
    body = (
      <Empty title={`${m.format(known[0])} · one ${per} so far`}>
        {bucketTitle(points[i].start, bucket)}, {plural(m.runs(points[i]), 'easy run')}. A trend line needs easy runs in at least two {per}s.
      </Empty>
    )
  }

  return (
    <Card title={m.title} subtitle={subtitle} className="flex-1 basis-[300px]">
      {body}
    </Card>
  )
}

// --- Heart-rate zones --------------------------------------------------------

const ZONE_KIND = ['Recovery', 'Aerobic', 'Tempo', 'Threshold', 'VO2 max']
/** Width kept free beside the longest zone bar for a value like '50% · 10 h 30 min'. */
const VALUE_ROOM = 116

function zoneLimits(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${Math.round(min)}–${Math.round(max)} bpm`
  if (max != null) return `under ${Math.round(max)} bpm`
  if (min != null) return `${Math.round(min)} bpm and up`
  return ''
}

function ZonesCard({ data }: { data: RunningData }) {
  const t = useTokens()
  const { zones, runsWithZones } = data.zones
  const total = zones.reduce((sum, z) => sum + z.seconds, 0)
  const maxShare = total > 0 ? Math.max(...zones.map((z) => z.seconds / total)) : 0

  return (
    <Card
      title="Time in heart-rate zones"
      subtitle={
        total > 0
          ? `Share of running time · ${runsWithZones} of ${plural(data.totals.runs, 'run')} with zone data`
          : 'Share of running time'
      }
      className="flex-1 basis-[300px]"
    >
      {total <= 0 ? (
        <Empty title="No zone data in this range">Zones come from runs tracked with an Apple Watch.</Empty>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {zones.map((z) => {
              const share = z.seconds / total
              const limits = zoneLimits(z.minBpm, z.maxBpm)
              const value = `${Math.round(share * 100)}% · ${fmtHoursMin(z.seconds)}`
              return (
                <li
                  key={z.zone}
                  title={`Zone ${z.zone} ${ZONE_KIND[z.zone - 1] ?? ''}${limits ? ` (${limits})` : ''}: ${value}`}
                  className="grid min-h-[46px] grid-cols-[104px_minmax(0,1fr)] items-center gap-2.5 border-t border-grid"
                >
                  <div>
                    <div>
                      <span className="font-semibold">Z{z.zone}</span>{' '}
                      <span className="text-[13px] text-ink2">{ZONE_KIND[z.zone - 1]}</span>
                    </div>
                    {limits && <div className="tnum text-xs text-muted">{limits}</div>}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      aria-hidden="true"
                      className="h-3.5 shrink-0 rounded-r"
                      style={{
                        // The longest bar stops short of the edge to leave room for its value.
                        width: `calc((100% - ${VALUE_ROOM}px) * ${(share / maxShare).toFixed(4)})`,
                        minWidth: z.seconds > 0 ? 2 : 0,
                        background: t.zone[z.zone - 1]
                      }}
                    />
                    <span className="tnum whitespace-nowrap text-[13px] text-ink2">{value}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="text-xs text-muted">Zones as computed by the watch; limits are those of the latest run.</div>
        </>
      )}
    </Card>
  )
}

// --- Key sessions ------------------------------------------------------------

function KeySessionsCard({ data }: { data: RunningData }) {
  const rows = data.keySessions
  return (
    <Card title="Key sessions" subtitle="Latest tempo, interval and long runs in this range">
      {rows.length === 0 ? (
        <Empty title="No key sessions in this range">Tempo, interval and long runs from your plan are listed here.</Empty>
      ) : (
        <WorkoutTable rows={rows} showYear={rows.some((r) => !sameYear(r.date, data.to))} />
      )}
    </Card>
  )
}
