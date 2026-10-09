import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import type { OverviewBucket, OverviewData, OverviewDay, OverviewWindow } from '@shared/api/overview'
import { addDays, mondayOf, weekStartsBetween, type RangeKey, type Ymd } from '@shared/dates'
import { CATEGORY_LABEL, type Category } from '@shared/domain'
import { fmtDateLong, fmtDateShort, fmtDateYear, fmtDayMonth, fmtHoursMin, fmtKm, fmtMonth, fmtNumber, pctChange } from '@shared/format'
import { Chart } from '@/components/Chart'
import { WorkoutTable } from '@/components/WorkoutTable'
import { Card, EmptyState, Legend, PageHeader, PageState, StatTile, Swatch, type Tone } from '@/components/ui'
import { useAppState } from '@/lib/app-state'
import { barSeries, baseOption, categoryAxis, stackedBarSeries, tipRow, valueAxis } from '@/lib/charts'
import { catVar, useTokens, type Tokens } from '@/lib/theme'
import { useApi } from '@/lib/useApi'

const RANGE_TEXT: Record<RangeKey, string> = {
  '4w': 'last 4 weeks',
  '12w': 'last 12 weeks',
  '6m': 'last 6 months',
  '1y': 'last year',
  all: 'all time'
}

export default function Overview() {
  const { range } = useAppState()
  const { data, loading, error } = useApi((api) => api.getOverview(range), [range])

  return (
    <>
      <PageHeader title="Overview" subtitle={data ? fmtDateLong(data.today) : undefined} />
      <PageState loading={loading} error={error} hasData={data != null}>
        {data && <Page data={data} />}
      </PageState>
    </>
  )
}

function Page({ data }: { data: OverviewData }) {
  const t = useTokens()
  const hasTraining = data.mix.length > 0
  return (
    <>
      <Tiles windows={data.windows} />
      {hasTraining ? (
        <>
          <section className="flex flex-wrap gap-4">
            <TrainingTimeCard data={data} t={t} />
            <MixCard data={data} />
          </section>
          <section className="flex flex-wrap gap-4">
            <DistanceCard data={data} t={t} />
            <LoadCard data={data} t={t} />
          </section>
          <section className="flex flex-wrap gap-4">
            <CalendarCard data={data} />
            <GymCard data={data} t={t} />
          </section>
        </>
      ) : (
        <Card>
          <EmptyState title="No training in this range">Choose a longer range to see earlier weeks.</EmptyState>
        </Card>
      )}
      {data.recent.length > 0 && (
        <Card
          title="Recent activities"
          action={
            <Link to="/activities" className="inline-flex min-h-6 items-center text-[13px] font-semibold text-ink">
              All activities
            </Link>
          }
        >
          <WorkoutTable rows={data.recent} showYear={data.recent.some((w) => w.date.slice(0, 4) !== data.today.slice(0, 4))} />
        </Card>
      )}
    </>
  )
}

// ---------- Headline tiles: the last 7 days against the 7 days before ----------

type Delta = { text: string; tone: Tone } | null

/**
 * Change line of a tile. More training reads as good; less is shown without a verdict,
 * because a lighter week is often planned.
 */
function change(now: number, prev: number, kind: 'percent' | 'count'): { delta: Delta; sub: string } {
  if (prev === 0) return { delta: null, sub: 'none in previous 7 days' }
  const diff = kind === 'percent' ? Math.round(pctChange(now, prev) ?? 0) : now - prev
  if (diff === 0) return { delta: null, sub: 'same as previous 7 days' }
  const amount = `${Math.abs(diff)}${kind === 'percent' ? '%' : ''}`
  return {
    delta: diff > 0 ? { text: `▲ ${amount}`, tone: 'good' } : { text: `▼ ${amount}`, tone: 'neutral' },
    sub: 'vs previous 7 days'
  }
}

function Tiles({ windows }: { windows: OverviewWindow[] }) {
  const now = windows[windows.length - 1]
  const prev = windows[windows.length - 2]
  const totalMin = Math.round(now.trainingS / 60)
  const hours = Math.floor(totalMin / 60)
  const distance = change(now.runDistanceM, prev.runDistanceM, 'percent')
  const time = change(now.trainingS, prev.trainingS, 'percent')
  const runs = change(now.runs, prev.runs, 'count')
  const gym = change(now.gymSessions, prev.gymSessions, 'count')
  return (
    <section className="flex flex-wrap gap-4">
      <StatTile
        label="Running distance · last 7 days"
        value={fmtKm(now.runDistanceM)}
        unit="km"
        delta={distance.delta}
        sub={distance.sub}
        spark={windows.map((w) => w.runDistanceM)}
      />
      <StatTile
        label="Training time · last 7 days"
        value={hours > 0 ? `${hours} h ${totalMin % 60}` : String(totalMin)}
        unit="min"
        delta={time.delta}
        sub={time.sub}
        spark={windows.map((w) => w.trainingS)}
      />
      <StatTile label="Runs · last 7 days" value={now.runs} delta={runs.delta} sub={runs.sub} spark={windows.map((w) => w.runs)} />
      <StatTile
        label="Gym sessions · last 7 days"
        value={now.gymSessions}
        delta={gym.delta}
        sub={gym.sub}
        spark={windows.map((w) => w.gymSessions)}
      />
    </section>
  )
}

// ---------- Shared pieces of the per-week / per-month charts ----------

const year = (d: Ymd): string => d.slice(0, 4)

/** Above this many monthly columns the axis names years only, under each January. */
const MAX_NAMED_MONTHS = 24

/** X-axis of the bucket charts: week starts, months, or just the years on long monthly ranges. */
function bucketAxis(t: Tokens, data: OverviewData) {
  if (data.unit === 'week') return categoryAxis(t, data.buckets.map((b) => fmtDayMonth(b.start)))
  if (data.buckets.length <= MAX_NAMED_MONTHS) {
    return categoryAxis(t, data.buckets.map((b) => `${fmtMonth(b.start)} ${year(b.start)}`))
  }
  return categoryAxis(
    t,
    data.buckets.map((b) => (b.start.slice(5, 7) === '01' ? year(b.start) : '')),
    { axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true, interval: 0 } }
  )
}

function bucketTitle(b: OverviewBucket, unit: OverviewData['unit']): string {
  const name = unit === 'week' ? `Week of ${fmtDateYear(b.start)}` : `${fmtMonth(b.start)} ${year(b.start)}`
  return b.current ? `${name} · in progress` : name
}

/** 'week of 5 Oct in progress', for card subtitles. */
function inProgress(data: OverviewData): string {
  const current = data.buckets[data.buckets.length - 1]
  return data.unit === 'week' ? `week of ${fmtDayMonth(current.start)} in progress` : `${fmtMonth(current.start)} in progress`
}

const tipHead = (text: string): string => `<div style="font-weight:600;margin-bottom:4px">${text}</div>`

/** Tooltip row without a colour key. */
const tipLine = (label: string, value: string): string =>
  `<div style="display:flex;gap:16px;justify-content:space-between;min-width:150px"><span>${label}</span>` +
  `<span style="font-weight:600;font-variant-numeric:tabular-nums">${value}</span></div>`

const tipNote = (t: Tokens, text: string): string => `<div style="color:${t.ink2}">${text}</div>`

/** Tooltip formatter that looks the hovered column up in `buckets`. */
function bucketTooltip(t: Tokens, data: OverviewData, body: (b: OverviewBucket) => string): EChartsOption['tooltip'] {
  return {
    ...baseOption(t).tooltip,
    formatter: (params: unknown) => {
      const b = data.buckets[(params as { dataIndex: number }[])[0]?.dataIndex ?? 0]
      return tipHead(bucketTitle(b, data.unit)) + body(b)
    }
  }
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

// ---------- Training time ----------

function TrainingTimeCard({ data, t }: { data: OverviewData; t: Tokens }) {
  const keys = useMemo(
    () => data.mix.map((m) => ({ key: m.category, label: CATEGORY_LABEL[m.category], color: t.cat[m.category] })),
    [data, t]
  )
  const option = useMemo<EChartsOption>(() => {
    const rows = data.buckets.map((b) =>
      Object.fromEntries(keys.map((k) => [k.key, (b.seconds[k.key] ?? 0) / 3600]))
    )
    return {
      ...baseOption(t),
      tooltip: bucketTooltip(t, data, (b) => {
        const parts = keys.filter((k) => (b.seconds[k.key] ?? 0) > 0)
        if (parts.length === 0) return tipNote(t, 'No training')
        const total = parts.reduce((s, k) => s + (b.seconds[k.key] ?? 0), 0)
        return (
          parts.map((k) => tipRow(k.color, k.label, fmtHoursMin(b.seconds[k.key] ?? 0))).join('') +
          (parts.length > 1 ? `<div style="margin-top:4px">${tipLine('Total', fmtHoursMin(total))}</div>` : '')
        )
      }),
      xAxis: bucketAxis(t, data),
      yAxis: valueAxis(t, {
        minInterval: 0.5,
        axisLabel: { color: t.muted, fontSize: 12, formatter: (v: number) => (v === 0 ? '0' : `${+v.toFixed(1)} h`) }
      }),
      series: stackedBarSeries(t, keys, rows)
    }
  }, [data, keys, t])

  return (
    <Card
      title={data.unit === 'week' ? 'Weekly training time' : 'Monthly training time'}
      subtitle={`Hours per ${data.unit} by session type · ${inProgress(data)}`}
      className="flex-[2] basis-[480px]"
    >
      <Legend items={keys.map((k) => ({ color: k.color, label: k.label }))} />
      <Chart option={option} height={240} className="grow" ariaLabel={`Stacked columns of training hours per ${data.unit}, split by session type`} />
    </Card>
  )
}

// ---------- Training mix ----------

function MixCard({ data }: { data: OverviewData }) {
  const total = data.mix.reduce((s, m) => s + m.seconds, 0)
  const hours = (s: number): string => `${(s / 3600).toFixed(1)} h`
  const share = (s: number): string => {
    const pct = (s / total) * 100
    return pct > 0 && pct < 0.5 ? '<1%' : `${Math.round(pct)}%`
  }
  return (
    <Card title="Training mix" subtitle={`Share of training time · ${RANGE_TEXT[data.rangeKey]}`} className="flex-1 basis-[300px]">
      <div
        className="flex h-4 gap-0.5 overflow-hidden rounded"
        role="img"
        aria-label={`Share of training time by session type: ${data.mix
          .map((m) => `${CATEGORY_LABEL[m.category]} ${share(m.seconds)}`)
          .join(', ')}`}
      >
        {data.mix.map((m) => (
          <div
            key={m.category}
            title={`${CATEGORY_LABEL[m.category]} · ${hours(m.seconds)} · ${share(m.seconds)}`}
            className="min-w-0.5"
            style={{ flex: `${m.seconds} 1 0`, background: catVar(m.category) }}
          />
        ))}
      </div>
      <div className="flex flex-col">
        {data.mix.map((m) => (
          <div key={m.category} className="flex items-center gap-2 border-t border-grid py-[9px]">
            <Swatch color={catVar(m.category)} />
            <span className="min-w-0 flex-1 truncate">{CATEGORY_LABEL[m.category]}</span>
            <span className="tnum text-ink2">{hours(m.seconds)}</span>
            <span className="tnum w-11 text-right font-semibold">{share(m.seconds)}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 border-t border-axis py-[9px]">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">Total</span>
            <span className="text-ink2"> · {plural(data.mix.reduce((s, m) => s + m.sessions, 0), 'session')}</span>
          </span>
          <span className="tnum font-semibold">{hours(total)}</span>
          <span className="w-11" />
        </div>
      </div>
      {data.mix.some((m) => m.category === 'other') && (
        <div className="text-xs text-muted">Other: runs without a Runna session type, and swims, rides and walks.</div>
      )}
    </Card>
  )
}

// ---------- Running distance and training load: one measure each, side by side ----------

function DistanceCard({ data, t }: { data: OverviewData; t: Tokens }) {
  const hasRuns = data.buckets.some((b) => b.runs > 0)
  const option = useMemo<EChartsOption>(
    () => ({
      ...baseOption(t),
      tooltip: bucketTooltip(t, data, (b) => {
        if (b.runs === 0) return tipNote(t, 'No runs')
        const km = b.runDistanceM == null ? 'not recorded' : `${fmtKm(b.runDistanceM)} km`
        return tipLine('Distance', km) + tipNote(t, plural(b.runs, 'run'))
      }),
      xAxis: bucketAxis(t, data),
      yAxis: valueAxis(t),
      series: barSeries(
        'Running distance',
        t.ink2,
        data.buckets.map((b) => (b.runDistanceM == null ? null : +(b.runDistanceM / 1000).toFixed(2)))
      )
    }),
    [data, t]
  )
  return (
    <Card title="Running distance" subtitle={`Kilometres per ${data.unit} · ${inProgress(data)}`} className="flex-1 basis-[300px]">
      {hasRuns ? (
        <Chart option={option} height={180} className="grow" ariaLabel={`Columns of kilometres run per ${data.unit}`} />
      ) : (
        <EmptyState title="No runs in this range" />
      )}
    </Card>
  )
}

function LoadCard({ data, t }: { data: OverviewData; t: Tokens }) {
  const hasLoad = data.buckets.some((b) => b.load != null && b.load > 0)
  const option = useMemo<EChartsOption>(
    () => ({
      ...baseOption(t),
      tooltip: bucketTooltip(t, data, (b) => {
        if (b.sessions === 0) return tipNote(t, 'No training')
        if (b.load == null) return tipNote(t, 'No effort ratings')
        const other = b.load - b.loadRun - b.loadGym
        return (
          tipLine('Load', fmtNumber(b.load)) +
          (b.loadRun > 0 ? tipLine('Running', fmtNumber(b.loadRun)) : '') +
          (b.loadGym > 0 ? tipLine('Gym', fmtNumber(b.loadGym)) : '') +
          (other >= 0.5 ? tipLine('Other', fmtNumber(other)) : '') +
          tipNote(t, `${b.ratedSessions} of ${plural(b.sessions, 'session')} rated`)
        )
      }),
      xAxis: bucketAxis(t, data),
      yAxis: valueAxis(t, { axisLabel: { color: t.muted, fontSize: 12, formatter: (v: number) => fmtNumber(v) } }),
      series: barSeries(
        'Training load',
        t.ink2,
        data.buckets.map((b) => (b.load == null ? null : Math.round(b.load)))
      )
    }),
    [data, t]
  )
  const ratingsStartInside = data.effortSince != null && data.effortSince > data.range.from
  return (
    <Card title="Training load" subtitle={`Effort rating × minutes per ${data.unit}, running and gym together`} className="flex-1 basis-[300px]">
      {hasLoad ? (
        <>
          <Chart option={option} height={180} className="grow" ariaLabel={`Columns of training load per ${data.unit}: effort rating times minutes`} />
          {ratingsStartInside && data.effortSince && (
            <div className="text-xs text-muted">
              Effort ratings start on {fmtDateYear(data.effortSince)}; earlier {data.unit}s have no load.
            </div>
          )}
        </>
      ) : (
        <EmptyState title="No effort ratings in this range">
          Load needs the effort rating that Apple Watch workouts carry.
        </EmptyState>
      )}
    </Card>
  )
}

// ---------- Training calendar ----------

const DAY_LEVELS: { below: number; color: string; label: string }[] = [
  { below: 40, color: 'var(--seq-1)', label: '1–39' },
  { below: 60, color: 'var(--seq-2)', label: '40–59' },
  { below: 90, color: 'var(--seq-3)', label: '60–89' },
  { below: Infinity, color: 'var(--seq-4)', label: '90+ min' }
]
const REST_COLOR = 'var(--sunk)'

interface DayCell {
  date: Ymd
  future: boolean
  day: OverviewDay | undefined
}

function dayColor(c: DayCell): string {
  if (c.future) return 'transparent'
  if (!c.day) return REST_COLOR
  const minutes = c.day.seconds / 60
  return (DAY_LEVELS.find((l) => minutes < l.below) ?? DAY_LEVELS[DAY_LEVELS.length - 1]).color
}

function dayText(c: DayCell): string {
  if (c.future) return 'Upcoming'
  if (!c.day) return 'Rest day'
  return `${fmtHoursMin(c.day.seconds)} · ${c.day.categories.map((k: Category) => CATEGORY_LABEL[k]).join(', ')}`
}

function CalendarCard({ data }: { data: OverviewData }) {
  const { calendar, today } = data
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; cell: DayCell } | null>(null)

  const { weeks, cells, months } = useMemo(() => {
    const byDate = new Map(calendar.days.map((d) => [d.date, d]))
    const weeks = weekStartsBetween(calendar.from, mondayOf(today))
    const cells: DayCell[] = weeks.flatMap((w) =>
      [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const date = addDays(w, i)
        return { date, future: date > today, day: byDate.get(date) }
      })
    )
    // A month is named above the first week that starts in it; the first column is named when there is room.
    const months = weeks.map((w) => (Number(w.slice(8)) <= 7 ? fmtMonth(w) : ''))
    if (months.length > 0 && !months[0] && !months[1] && !months[2]) months[0] = fmtMonth(weeks[0])
    return { weeks, cells, months }
  }, [calendar, today])

  const dense = weeks.length > 26
  const gap = dense ? 2 : 4
  const columns = `repeat(${weeks.length}, minmax(${dense ? 5 : 12}px, 44px))`

  // When the weeks do not fit, the newest ones are the ones to show.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [weeks.length])

  function onOver(e: MouseEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement
    const i = el.dataset.i
    if (i == null || !host.current) return
    const cellBox = el.getBoundingClientRect()
    const hostBox = host.current.getBoundingClientRect()
    const x = cellBox.left + cellBox.width / 2 - hostBox.left
    setTip({ x: Math.min(Math.max(x, 90), Math.max(90, hostBox.width - 90)), y: cellBox.top - hostBox.top, cell: cells[Number(i)] })
  }

  return (
    <Card
      title="Training calendar"
      subtitle={`Minutes of training per day · ${calendar.capped ? `most recent ${calendar.weeks} weeks` : RANGE_TEXT[data.rangeKey]}`}
      className="flex-[2] basis-[480px]"
    >
      <div ref={host} className="relative">
        <div ref={scroller} className="overflow-x-auto">
          <div className="flex gap-2 pr-4">
            <div className="grid shrink-0 text-xs text-muted" style={{ gridTemplateRows: 'repeat(7, 20px)', gap, marginTop: 22, lineHeight: '20px' }}>
              {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d, i) => (
                <div key={i}>{d}</div>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="grid h-[18px] text-xs text-muted" style={{ gridTemplateColumns: columns, gap }} aria-hidden="true">
                {months.map((m, i) => (
                  <div key={i} className="whitespace-nowrap">{m}</div>
                ))}
              </div>
              <div
                className="grid"
                style={{ gridTemplateColumns: columns, gridTemplateRows: 'repeat(7, 20px)', gridAutoFlow: 'column', gap }}
                role="img"
                aria-label={`Calendar of training minutes per day over ${plural(weeks.length, 'week')}; ${plural(calendar.days.length, 'day')} with training`}
                onMouseOver={onOver}
                onMouseLeave={() => setTip(null)}
              >
                {cells.map((c, i) => (
                  <div
                    key={c.date}
                    data-i={i}
                    className={c.future ? 'rounded border border-grid' : 'rounded'}
                    style={{ background: dayColor(c) }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] shadow-lg"
            style={{ left: tip.x, top: tip.y - 6 }}
          >
            <div className="font-semibold">{fmtDateShort(tip.cell.date)} {year(tip.cell.date)}</div>
            <div className="text-ink2">{dayText(tip.cell)}</div>
          </div>
        )}
      </div>
      <Legend items={[{ color: REST_COLOR, label: 'Rest' }, ...DAY_LEVELS.map((l) => ({ color: l.color, label: l.label }))]} />
    </Card>
  )
}

// ---------- Gym ----------

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-2xl font-semibold leading-tight">{value}</div>
      <div className="text-[13px] text-ink2">{label}</div>
    </div>
  )
}

function GymCard({ data, t }: { data: OverviewData; t: Tokens }) {
  const { gym } = data
  const option = useMemo<EChartsOption>(
    () => ({
      ...baseOption(t),
      tooltip: bucketTooltip(t, data, (b) => tipNote(t, b.gymSessions === 0 ? 'No gym sessions' : plural(b.gymSessions, 'gym session'))),
      xAxis: bucketAxis(t, data),
      yAxis: valueAxis(t, { minInterval: 1, splitNumber: 2 }),
      series: barSeries(
        'Gym sessions',
        t.cat.strength,
        data.buckets.map((b) => b.gymSessions)
      )
    }),
    [data, t]
  )
  const hrLabel =
    gym.avgHr == null
      ? 'avg heart rate · not recorded'
      : gym.hrSessions < gym.sessions
        ? `avg heart rate · ${gym.hrSessions} of ${gym.sessions} sessions`
        : 'avg heart rate'
  return (
    <Card title="Gym" subtitle={`Strength sessions per ${data.unit} · ${RANGE_TEXT[data.rangeKey]}`} className="flex-1 basis-[300px]">
      {gym.sessions > 0 ? (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Figure value={String(gym.sessions)} label={gym.sessions === 1 ? 'session' : 'sessions'} />
            <Figure value={gym.avgDurationS == null ? '–' : `${Math.round(gym.avgDurationS / 60)} min`} label="avg duration" />
            <Figure value={gym.avgHr == null ? '–' : `${Math.round(gym.avgHr)} bpm`} label={hrLabel} />
          </div>
          <Chart option={option} height={120} className="grow" ariaLabel={`Columns of gym sessions per ${data.unit}`} />
        </>
      ) : (
        <EmptyState title="No gym sessions in this range" />
      )}
    </Card>
  )
}
