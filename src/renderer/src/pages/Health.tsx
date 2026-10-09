import { useMemo, type ReactNode } from 'react'
import type { EChartsOption, SeriesOption } from 'echarts'
import type { DateSpan, HealthData, HealthMetric, MetricSummary, SleepSeries } from '@shared/api/health'
import { addDays, diffDays, type Ymd } from '@shared/dates'
import { fmtDateShort, fmtDateYear, fmtDayMonth, fmtHoursMin, fmtMonth, fmtNumber } from '@shared/format'
import { Chart } from '@/components/Chart'
import { Card, EmptyState, Legend, PageHeader, PageState, StatTile, type Tone } from '@/components/ui'
import { useAppState } from '@/lib/app-state'
import { baseOption, categoryAxis, lineSeries, stackedBarSeries, tipRow, tooltip, valueAxis, type StackKey } from '@/lib/charts'
import { useTokens, type Tokens } from '@/lib/theme'
import { useApi } from '@/lib/useApi'
import { niceScale, rangeSubtitle, tipHead, tipIndex, tipNote } from './Gym'

/** How one metric is written and which direction of change counts as good (null: neither). */
interface MetricDef {
  name: string
  /** Lower-case name for running text. */
  noun: string
  unit: string
  digits: number
  better: 'higher' | 'lower' | null
}

const RESTING_HR: MetricDef = { name: 'Resting heart rate', noun: 'resting heart rate', unit: 'bpm', digits: 0, better: 'lower' }
const HRV: MetricDef = { name: 'Heart-rate variability', noun: 'heart-rate variability', unit: 'ms', digits: 0, better: 'higher' }
const VO2MAX: MetricDef = { name: 'VO2 max', noun: 'VO2 max', unit: 'ml/kg/min', digits: 1, better: 'higher' }
const HR_RECOVERY: MetricDef = { name: 'Heart-rate recovery', noun: 'heart-rate recovery', unit: 'bpm', digits: 0, better: 'higher' }
const WEIGHT: MetricDef = { name: 'Weight', noun: 'weight', unit: 'kg', digits: 1, better: null }

/** Readings further apart than this are not joined by a line. */
const MAX_LINE_GAP_DAYS = 60

const hm = (hours: number): string => fmtHoursMin(hours * 3600)

/** '21–27 Aug', '29 Aug – 4 Sep'; the year is added when it is not `today`'s. */
function spanText(span: DateSpan, today: Ymd): string {
  const year = span.to.slice(0, 4) === today.slice(0, 4) ? '' : ` ${span.to.slice(0, 4)}`
  if (span.from === span.to) return fmtDayMonth(span.to) + year
  if (span.from.slice(0, 7) === span.to.slice(0, 7)) return `${Number(span.from.slice(8))}–${fmtDayMonth(span.to)}${year}`
  return `${fmtDayMonth(span.from)} – ${fmtDayMonth(span.to)}${year}`
}

function dateText(d: Ymd, today: Ymd): string {
  return d.slice(0, 4) === today.slice(0, 4) ? fmtDayMonth(d) : fmtDateYear(d)
}

/** Colours of the single-series charts and the sleep stages, all from the sequential ramp. */
function palette(t: Tokens): { line: string; deep: string; core: string; rem: string } {
  // The ramp runs low to high, which is light to dark in light mode and the reverse in dark
  // mode. Deep sleep takes the darkest step in both.
  const [deep, rem] = t.dark ? [t.seq[1], t.seq[3]] : [t.seq[3], t.seq[1]]
  return { line: t.seq[2], deep, core: t.seq[2], rem }
}

export default function Health() {
  const { range } = useAppState()
  const { data, loading, error } = useApi((api) => api.getHealth(range), [range])
  return (
    <>
      <PageHeader title="Health" subtitle={data ? rangeSubtitle(data.range) : undefined} />
      <PageState loading={loading} error={error} hasData={data != null}>
        {data && <HealthContent data={data} />}
      </PageState>
    </>
  )
}

function HealthContent({ data }: { data: HealthData }) {
  const today = data.range.to
  if (!data.hasData) {
    return (
      <Card>
        <EmptyState title="No body metrics yet">
          Resting heart rate, heart-rate variability, sleep, VO2 max and weight appear here once your Apple Health export contains them.
        </EmptyState>
      </Card>
    )
  }
  return (
    <>
      <section className="flex flex-wrap gap-4">
        <MetricTile def={RESTING_HR} summary={data.restingHr.summary} daily today={today} />
        <MetricTile def={HRV} summary={data.hrv.summary} daily today={today} />
        <SleepTile summary={data.sleep.summary} today={today} />
        <MetricTile def={VO2MAX} summary={data.vo2max.summary} today={today} />
        <MetricTile def={WEIGHT} summary={data.weight.summary} today={today} />
      </section>

      <section className="flex flex-wrap gap-4">
        <DailyCard def={RESTING_HR} metric={data.restingHr} data={data} caption="Beats per minute at rest" />
        <DailyCard def={HRV} metric={data.hrv} data={data} caption="SDNN in milliseconds" />
      </section>

      <section className="flex flex-wrap gap-4">
        <SleepCard data={data} />
        <SleepStagesCard data={data} />
      </section>

      <section className="flex flex-wrap gap-4">
        <ReadingCard def={VO2MAX} metric={data.vo2max} data={data} caption="Apple Watch estimate in ml/kg/min" />
        <ReadingCard def={HR_RECOVERY} metric={data.hrRecovery} data={data} caption="Drop in bpm one minute after a workout" />
        <ReadingCard def={WEIGHT} metric={data.weight} data={data} caption="Kilograms, one dot per weigh-in" />
      </section>

      <div className="text-[13px] text-muted">
        Figures as recorded in Apple Health. They describe trends in your own data and are not medical advice.
      </div>
    </>
  )
}

// ---------------------------------------------------------------- tiles

interface TileText {
  value: ReactNode
  unit?: string
  delta: { text: string; tone: Tone } | null
  sub: string
}

/**
 * Turns a summary into tile content. `amount` writes an absolute difference with its unit,
 * or returns null when it rounds to nothing.
 */
function tileText(
  summary: MetricSummary,
  opts: {
    daily: boolean
    today: Ymd
    better: MetricDef['better']
    value: (v: number) => ReactNode
    unit: string
    plain: (v: number) => string
    amount: (diff: number) => string | null
  }
): TileText {
  const { daily, today } = opts
  if (summary.current == null) {
    return {
      value: '–',
      delta: null,
      sub: summary.last ? `None in this range · last ${opts.plain(summary.last.value)} on ${fmtDateYear(summary.last.date)}` : 'Not in your Health data'
    }
  }
  const base = { value: opts.value(summary.current), unit: opts.unit }
  if (summary.baseline == null || summary.baselineSpan == null) {
    const sub = daily
      ? `${summary.count} ${summary.count === 1 ? 'day' : 'days'} of data, too few to compare`
      : `Only reading in this range`
    return { ...base, delta: null, sub }
  }
  const diff = summary.current - summary.baseline
  const amount = opts.amount(Math.abs(diff))
  const against = daily ? `vs ${spanText(summary.baselineSpan, today)}` : `since ${dateText(summary.baselineSpan.from, today)}`
  if (amount == null) return { ...base, delta: { text: 'No change', tone: 'neutral' }, sub: against }
  const up = diff > 0
  const tone: Tone = opts.better == null ? 'neutral' : (opts.better === 'higher') === up ? 'good' : 'bad'
  return { ...base, delta: { text: `${up ? '▲' : '▼'} ${amount}`, tone }, sub: against }
}

/** 'Resting heart rate · 7-day avg', or '· 7 days to 3 Oct' / '· 3 Oct' when the data does not reach today. */
function tileLabel(name: string, summary: MetricSummary, daily: boolean, today: Ymd): string {
  const to = summary.currentSpan?.to
  if (!to) return name
  const fresh = to >= addDays(today, -1)
  if (daily) return `${name} · ${fresh ? '7-day avg' : `7 days to ${dateText(to, today)}`}`
  return `${name} · ${to === today ? 'today' : dateText(to, today)}`
}

function MetricTile({ def, summary, daily = false, today }: { def: MetricDef; summary: MetricSummary; daily?: boolean; today: Ymd }) {
  const plain = (v: number): string => `${fmtNumber(v, def.digits)} ${def.unit}`
  const text = tileText(summary, {
    daily,
    today,
    better: def.better,
    value: (v) => fmtNumber(v, def.digits),
    unit: def.unit,
    plain,
    amount: (d) => (Number(d.toFixed(def.digits)) === 0 ? null : plain(d))
  })
  return <StatTile label={tileLabel(def.name, summary, daily, today)} value={text.value} unit={text.unit} delta={text.delta} sub={text.sub} />
}

function SleepTile({ summary, today }: { summary: MetricSummary; today: Ymd }) {
  const text = tileText(summary, {
    daily: true,
    today,
    // More sleep is not better without limit, so the change stays neutral.
    better: null,
    value: (v) => {
      const min = Math.round(v * 60)
      return (
        <>
          {Math.floor(min / 60)}
          <span className="mx-1 text-[15px] font-normal text-ink2">h</span>
          {min % 60}
        </>
      )
    },
    unit: 'min',
    plain: hm,
    amount: (d) => (Math.round(d * 60) === 0 ? null : hm(d))
  })
  return <StatTile label={tileLabel('Sleep', summary, true, today)} value={text.value} unit={text.unit} delta={text.delta} sub={text.sub} />
}

// ---------------------------------------------------------------- chart pieces

/**
 * Category axis with one slot per day. Which days get a label depends on the span:
 * Mondays, then the 1st of each month, then 1 January.
 */
function dayAxis(t: Tokens, dates: Ymd[], bars = false): ReturnType<typeof categoryAxis> {
  const n = dates.length
  const mode = n <= 10 ? 'day' : n <= 75 ? 'week' : n <= 800 ? 'month' : 'year'
  const show = (d: Ymd): boolean =>
    mode === 'day' ||
    (mode === 'week' && new Date(`${d}T00:00:00Z`).getUTCDay() === 1) ||
    (mode === 'month' && d.endsWith('-01')) ||
    (mode === 'year' && d.endsWith('-01-01'))
  const text = (d: Ymd): string =>
    mode === 'year' ? d.slice(0, 4) : mode === 'month' ? (d.slice(5, 7) === '01' ? `${fmtMonth(d)} ${d.slice(0, 4)}` : fmtMonth(d)) : fmtDayMonth(d)
  return categoryAxis(t, dates, {
    boundaryGap: bars,
    axisLabel: {
      color: t.muted,
      fontSize: 12,
      hideOverlap: true,
      interval: (_i: number, value: string) => show(value),
      formatter: (value: string) => text(value)
    }
  })
}

/**
 * Prints `text` to the right of a line's end dot and returns the grid that leaves room for it.
 * Beside the dot the label cannot sit on the line, whichever way the line arrives.
 */
function labelEnd(t: Tokens, series: SeriesOption[], text: string | null): { series: SeriesOption[]; grid: EChartsOption['grid'] } {
  const grid = { left: 4, right: text ? 20 + Math.ceil(text.length * 7.5) : 12, top: 18, bottom: 2, containLabel: true }
  if (!text) return { series, grid }
  const label = { show: true, formatter: text, position: 'right', distance: 7, color: t.ink, fontWeight: 600, fontSize: 13 }
  return {
    grid,
    series: series.map((x) => {
      const mark = (x as { markPoint?: Record<string, unknown> }).markPoint
      return mark ? ({ ...x, markPoint: { ...mark, label } } as SeriesOption) : x
    })
  }
}

function list(series: SeriesOption | SeriesOption[]): SeriesOption[] {
  return Array.isArray(series) ? series : [series]
}

function withSymbols(series: SeriesOption | SeriesOption[], size: number): SeriesOption[] {
  return list(series).map((x) => ({ ...x, showSymbol: true, showAllSymbol: true, symbolSize: size }) as SeriesOption)
}

function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i]
  return null
}

/** Card subtitle: the caption, plus where the data begins when that is later than the range start. */
function captionWithStart(caption: string, dates: Ymd[], data: HealthData): string {
  if (dates.length === 0 || diffDays(data.range.from, dates[0]) <= 7) return caption
  return `${caption} · data from ${dateText(dates[0], data.range.to)}`
}

function NoValues({ def, summary }: { def: MetricDef; summary: MetricSummary }) {
  return (
    <EmptyState title={summary.last ? `No ${def.noun} in this range` : `No ${def.noun} recorded`}>
      {summary.last
        ? `The latest value is ${fmtNumber(summary.last.value, def.digits)} ${def.unit} from ${fmtDateYear(summary.last.date)}. Choose a longer range to see it.`
        : 'Your Apple Health export has no values for it.'}
    </EmptyState>
  )
}

// ---------------------------------------------------------------- daily metrics

/** A metric measured every day: the day's value as a dot, its 7-day mean as the line. */
function DailyCard({ def, metric, data, caption }: { def: MetricDef; metric: HealthMetric; data: HealthData; caption: string }) {
  const t = useTokens()
  const { dates, values, avg7 } = metric.series
  const color = palette(t).line

  const option = useMemo<EChartsOption>(() => {
    const avg = avg7 ?? []
    const write = (v: number, digits: number): string => `${fmtNumber(v, digits)} ${def.unit}`
    const latestAvg = lastValue(avg)
    const line = labelEnd(
      t,
      list(lineSeries(t, '7-day average', color, avg, { connectNulls: true })),
      latestAvg != null ? write(latestAvg, def.digits) : null
    )
    return {
      ...baseOption(t),
      grid: line.grid,
      tooltip: tooltip(t, {
        formatter: (params: unknown) => {
          const i = tipIndex(params)
          const head = tipHead(fmtDateShort(dates[i]))
          if (values[i] == null && avg[i] == null) return head + tipNote(t, 'No value')
          return (
            head +
            (values[i] != null ? tipRow(t.ctx, 'This day', write(values[i]!, def.digits)) : '') +
            (avg[i] != null ? tipRow(color, '7-day average', write(avg[i]!, 1)) : '')
          )
        }
      }),
      xAxis: dayAxis(t, dates),
      yAxis: valueAxis(t, niceScale([...values, ...avg].filter((v): v is number => v != null))),
      series: [
        {
          name: 'Daily value',
          type: 'scatter',
          data: values,
          symbolSize: dates.length > 200 ? 3 : 5,
          itemStyle: { color: t.ctx },
          emphasis: { disabled: true },
          silent: true
        },
        ...line.series
      ] as SeriesOption[]
    }
  }, [t, dates, values, avg7, def, color])

  return (
    <Card title={def.name} subtitle={captionWithStart(caption, dates, data)} className="flex-1 basis-[380px]">
      {dates.length === 0 ? (
        <NoValues def={def} summary={metric.summary} />
      ) : (
        <>
          <Legend
            items={[
              { color, label: '7-day average' },
              { color: t.ctx, label: 'Daily value' }
            ]}
          />
          <Chart option={option} height={200} ariaLabel={`Chart of ${def.noun} per day with its 7-day average over the selected range`} />
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- occasional readings

/** Splits readings into runs that are close enough in time to be joined by a line. */
function lineRuns(values: (number | null)[]): (number | null)[][] {
  const runs: (number | null)[][] = []
  let last = -1
  values.forEach((v, i) => {
    if (v == null) return
    if (last < 0 || i - last > MAX_LINE_GAP_DAYS) runs.push(new Array<number | null>(values.length).fill(null))
    runs[runs.length - 1][i] = v
    last = i
  })
  return runs
}

/** A metric measured now and then: a dot per reading, joined where readings are close together. */
function ReadingCard({ def, metric, data, caption }: { def: MetricDef; metric: HealthMetric; data: HealthData; caption: string }) {
  const t = useTokens()
  const { dates, values } = metric.series
  const color = palette(t).line
  const today = data.range.to

  const option = useMemo<EChartsOption>(() => {
    const write = (v: number): string => `${fmtNumber(v, def.digits)} ${def.unit}`
    const runs = lineRuns(values)
    const count = values.filter((v) => v != null).length
    // Index of the latest reading on or before each day, for the tooltip between readings.
    const prev: number[] = []
    values.forEach((v, i) => prev.push(v != null ? i : i > 0 ? prev[i - 1] : -1))
    const latest = lastValue(values)
    const lines = runs.flatMap((run, r) => {
      const line = withSymbols(lineSeries(t, def.name, color, run, { connectNulls: true }), count > 150 ? 4 : 6)
      // Only the last run keeps the emphasised end dot.
      return r === runs.length - 1 ? line : line.map((x) => ({ ...x, markPoint: undefined }) as SeriesOption)
    })
    // The unit is in the card's subtitle, so the end label is the bare number.
    const { series, grid } = labelEnd(t, lines, latest != null ? fmtNumber(latest, def.digits) : null)
    return {
      ...baseOption(t),
      grid,
      tooltip: tooltip(t, {
        formatter: (params: unknown) => {
          const i = tipIndex(params)
          const head = tipHead(fmtDateYear(dates[i]))
          if (values[i] != null) return head + tipRow(color, def.name, write(values[i]!))
          const p = prev[i]
          return head + tipNote(t, p >= 0 ? `No reading · last ${write(values[p]!)} on ${dateText(dates[p], today)}` : 'No reading')
        }
      }),
      xAxis: dayAxis(t, dates),
      yAxis: valueAxis(t, niceScale(values.filter((v): v is number => v != null))),
      series
    }
  }, [t, dates, values, def, color, today])

  return (
    <Card title={def.name} subtitle={captionWithStart(caption, dates, data)} className="flex-1 basis-[300px]">
      {dates.length === 0 ? (
        <NoValues def={def} summary={metric.summary} />
      ) : (
        <Chart option={option} height={200} ariaLabel={`Line chart of ${def.noun} readings over the selected range`} />
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- sleep

const SLEEP_BUCKET_TEXT: Record<SleepSeries['bucket'], string> = {
  night: 'Hours asleep per night',
  week: 'Hours asleep per night, averaged by week',
  month: 'Hours asleep per night, averaged by month'
}

function SleepCard({ data }: { data: HealthData }) {
  const t = useTokens()
  const s = data.sleep.series
  const p = palette(t)

  const { option, keys } = useMemo(() => {
    // The part of a night that has no stage: all of it for sources that record none.
    const rest = s.starts.map((_, i) => {
      const total = s.total[i]
      if (total == null) return 0
      const staged = (s.deep[i] ?? 0) + (s.core[i] ?? 0) + (s.rem[i] ?? 0)
      return total - staged > 0.02 ? total - staged : 0
    })
    const keys: StackKey[] = [
      { key: 'deep', label: 'Deep', color: p.deep },
      { key: 'core', label: 'Core', color: p.core },
      { key: 'rem', label: 'REM', color: p.rem }
    ]
    if (rest.some((v) => v > 0)) keys.push({ key: 'rest', label: 'No stage recorded', color: t.ctx })
    const rows = s.starts.map((_, i) => ({ deep: s.deep[i] ?? 0, core: s.core[i] ?? 0, rem: s.rem[i] ?? 0, rest: rest[i] }))

    const head = (i: number): string => {
      const d = s.starts[i]
      if (s.bucket === 'night') return tipHead(`Night to ${fmtDateShort(d)}`)
      const title = s.bucket === 'week' ? `Week of ${fmtDayMonth(d)} ${d.slice(0, 4)}` : `${fmtMonth(d)} ${d.slice(0, 4)}`
      return tipHead(title) + tipNote(t, `Average of ${s.nights[i]} ${s.nights[i] === 1 ? 'night' : 'nights'}`)
    }
    const labels = s.bucket === 'night' ? s.starts : s.starts.map((d) => (s.bucket === 'week' ? fmtDayMonth(d) : d.slice(5, 7) === '01' ? d.slice(0, 4) : fmtMonth(d)))
    const option: EChartsOption = {
      ...baseOption(t),
      tooltip: tooltip(t, {
        formatter: (params: unknown) => {
          const i = tipIndex(params)
          const total = s.total[i]
          if (total == null) return head(i) + tipNote(t, 'No sleep recorded')
          return (
            head(i) +
            `<div style="display:flex;justify-content:space-between;gap:8px;margin:4px 0"><span>Asleep</span><span style="font-weight:600">${hm(total)}</span></div>` +
            // Listed top segment first, the way the column is stacked.
            [...keys]
              .reverse()
              .filter((k) => rows[i][k.key as keyof (typeof rows)[number]] > 0)
              .map((k) => tipRow(k.color, k.label, hm(rows[i][k.key as keyof (typeof rows)[number]])))
              .join('')
          )
        }
      }),
      xAxis: s.bucket === 'night' ? dayAxis(t, s.starts, true) : categoryAxis(t, labels),
      yAxis: valueAxis(t, {
        minInterval: 1,
        axisLabel: { color: t.muted, fontSize: 12, formatter: (v: number) => (v === 0 ? '0' : `${v} h`) }
      }),
      series: stackedBarSeries(t, keys, rows)
    }
    return { option, keys }
  }, [t, s, p.deep, p.core, p.rem])

  const subtitle = captionWithStart(`${SLEEP_BUCKET_TEXT[s.bucket]}, naps included · a night counts for the day it ended on`, s.starts, data)

  return (
    <Card title="Sleep" subtitle={subtitle} className="flex-[2] basis-[480px]">
      {s.starts.length === 0 ? (
        <EmptyState title="No sleep in this range">
          {data.sleep.summary.last
            ? `The latest night is from ${fmtDateYear(data.sleep.summary.last.date)}. Choose a longer range to see it.`
            : 'Your Apple Health export has no sleep data.'}
        </EmptyState>
      ) : (
        <>
          <Legend items={keys.map((k) => ({ color: k.color, label: k.label }))} />
          <Chart option={option} ariaLabel="Stacked column chart of hours asleep per night, split into deep, core and REM sleep" />
        </>
      )}
    </Card>
  )
}

function SleepStagesCard({ data }: { data: HealthData }) {
  const t = useTokens()
  const p = palette(t)
  const st = data.sleep.stages
  const { shortest, longest } = data.sleep
  const today = data.range.to

  const rows = st
    ? [
        { label: 'REM', hours: st.remHours, color: p.rem },
        { label: 'Core', hours: st.coreHours, color: p.core },
        { label: 'Deep', hours: st.deepHours, color: p.deep }
      ]
    : []
  const widest = Math.max(...rows.map((r) => r.hours), 0)

  return (
    <Card
      title="Average night"
      subtitle={st ? `Mean of ${st.nights} ${st.nights === 1 ? 'night' : 'nights'} with sleep stages` : 'Sleep stages'}
      className="flex-1 basis-[300px]"
    >
      {!st ? (
        <EmptyState title="No sleep stages in this range">Stages are recorded when you wear the Apple Watch at night.</EmptyState>
      ) : (
        <div className="flex flex-col">
          <div className="flex items-baseline gap-1.5 pb-3">
            <span className="text-[26px] font-semibold leading-tight">{hm(st.totalHours)}</span>
            <span className="text-[13px] text-ink2">asleep</span>
          </div>
          {rows.map((r) => (
            <div key={r.label} className="grid min-h-11 grid-cols-[52px_minmax(0,1fr)] items-center gap-2.5 border-t border-grid">
              <div className="font-semibold">{r.label}</div>
              <div className="flex items-center gap-2">
                <div
                  className="h-3.5 rounded-r"
                  style={{ width: `${widest > 0 ? (r.hours / widest) * 55 : 0}%`, minWidth: 2, background: r.color }}
                  title={`${r.label} · ${hm(r.hours)} · ${Math.round((r.hours / st.totalHours) * 100)}%`}
                />
                <span className="tnum whitespace-nowrap text-[13px] text-ink2">
                  {hm(r.hours)} · {Math.round((r.hours / st.totalHours) * 100)}%
                </span>
              </div>
            </div>
          ))}
          {shortest && longest && shortest.date !== longest.date && (
            <div className="flex flex-col gap-1 border-t border-grid pt-3 text-[13px] text-ink2">
              <div className="flex justify-between gap-2">
                <span>Shortest · {dateText(shortest.date, today)}</span>
                <span className="tnum font-semibold text-ink">{hm(shortest.hours)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Longest · {dateText(longest.date, today)}</span>
                <span className="tnum font-semibold text-ink">{hm(longest.hours)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
