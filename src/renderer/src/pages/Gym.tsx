import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EChartsOption, SeriesOption } from 'echarts'
import { GYM_TABLE_LIMIT, type GymData, type GymSession } from '@shared/api/gym'
import { RANGE_OPTIONS, type RangeKey, type Ymd } from '@shared/dates'
import { fmtDateShort, fmtDateYear, fmtDayMonth, fmtHoursMin, fmtMonth, fmtNumber } from '@shared/format'
import { Chart } from '@/components/Chart'
import { WorkoutTable } from '@/components/WorkoutTable'
import { Card, EmptyState, Legend, PageHeader, PageState, StatTile, type Tone } from '@/components/ui'
import { useAppState } from '@/lib/app-state'
import { barSeries, baseOption, categoryAxis, lineSeries, tipRow, tooltip, valueAxis } from '@/lib/charts'
import { useTokens, type Tokens } from '@/lib/theme'
import { useApi } from '@/lib/useApi'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** '20 Jul to 9 Oct 2026', with the year on both ends when they differ. */
export function rangeSubtitle(range: { from: Ymd; to: Ymd }): string {
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4)
  return `${sameYear ? fmtDayMonth(range.from) : fmtDateYear(range.from)} to ${fmtDateYear(range.to)}`
}

/** Bold first line of a chart tooltip. */
export function tipHead(text: string): string {
  return `<div style="font-weight:600;margin-bottom:4px">${text}</div>`
}

/** Secondary tooltip line without a colour key. */
export function tipNote(t: Tokens, text: string): string {
  return `<div style="color:${t.ink2};font-size:12px;margin-top:2px">${text}</div>`
}

/** Index of the hovered column in an axis-triggered tooltip. */
export function tipIndex(params: unknown): number {
  const first = Array.isArray(params) ? params[0] : params
  return (first as { dataIndex: number }).dataIndex
}

/**
 * Bounds and step for a y-axis that hugs the data instead of starting at zero, for measures
 * where zero means nothing (heart rate, weight). Gives at most `maxSteps` even intervals.
 */
export function niceScale(values: number[], maxSteps = 4): { min?: number; max?: number; interval?: number } {
  if (values.length === 0) return {}
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  // A single value (or a flat series) gets room on both sides instead of sitting on the baseline.
  if (lo === hi) {
    lo -= 1
    hi += 1
  }
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) {
    const min = Math.floor(lo / step) * step
    const max = Math.max(Math.ceil(hi / step) * step, min + step)
    if ((max - min) / step <= maxSteps) return { min, max, interval: step }
  }
  return {}
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export default function Gym() {
  const { range } = useAppState()
  const { data, loading, error } = useApi((api) => api.getGym(range), [range])
  return (
    <>
      <PageHeader title="Gym" subtitle={data ? rangeSubtitle(data.range) : undefined} />
      <PageState loading={loading} error={error} hasData={data != null}>
        {data && <GymContent data={data} range={range} />}
      </PageState>
    </>
  )
}

function GymContent({ data, range }: { data: GymData; range: RangeKey }) {
  const s = data.summary
  const rangeLabel = (RANGE_OPTIONS.find((o) => o.key === range)?.label ?? '').toLowerCase()

  if (data.totalSessions === 0) {
    return (
      <Card>
        <EmptyState title="No gym sessions yet">
          Strength workouts recorded on your Apple Watch appear here after the next import.
        </EmptyState>
      </Card>
    )
  }

  let sessionsDelta: { text: string; tone: Tone } | null = null
  // Nothing now and nothing before is not a change worth a line.
  const comparable = s.prevSessions != null && (s.sessions > 0 || s.prevSessions > 0)
  if (s.prevSessions != null && comparable) {
    const diff = s.sessions - s.prevSessions
    sessionsDelta =
      diff === 0 ? { text: 'Same as', tone: 'neutral' } : { text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}`, tone: diff > 0 ? 'good' : 'bad' }
  }
  const sessionsSub =
    comparable
      ? `${sessionsDelta?.tone === 'neutral' ? 'the' : 'vs'} previous ${rangeLabel}`
      : data.sessions.length > 0
        ? `since ${fmtDateYear(data.sessions[0].date)}`
        : undefined

  const streak =
    s.streakWeeks === 0 ? 'No session this week or last' : s.streakWeeks === 1 ? '1 week running' : `${s.streakWeeks} weeks in a row`

  return (
    <>
      <section className="flex flex-wrap gap-4">
        <StatTile label={`Sessions · ${rangeLabel}`} value={s.sessions} delta={sessionsDelta} sub={sessionsSub} />
        <StatTile label="Weeks trained" value={s.weeksTrained} unit={`of ${data.range.weeks}`} sub={streak} />
        <StatTile
          label="Average session"
          value={s.avgDurationS != null ? Math.round(s.avgDurationS / 60) : '–'}
          unit={s.avgDurationS != null ? 'min' : undefined}
          sub={s.sessions > 0 ? `${fmtHoursMin(s.totalDurationS)} in total` : undefined}
        />
        <StatTile
          label="Average heart rate"
          value={s.avgHr != null ? Math.round(s.avgHr) : '–'}
          unit={s.avgHr != null ? 'bpm' : undefined}
          sub={
            s.sessions === 0
              ? undefined
              : s.hrSessions === 0
                ? 'No heart rate recorded in this range'
                : s.hrSessions === s.sessions
                  ? `across ${plural(s.sessions, 'session')}`
                  : `from ${s.hrSessions} of ${s.sessions} sessions`
          }
        />
      </section>

      {s.sessions === 0 ? (
        <Card>
          <EmptyState title="No gym sessions in this range">
            {data.lastSessionDate && <>The last one was on {fmtDateYear(data.lastSessionDate)}. Choose a longer range to see it.</>}
          </EmptyState>
        </Card>
      ) : (
        <>
          <section className="flex flex-wrap gap-4">
            <TrainingTime data={data} />
            <WeekdayPattern data={data} />
          </section>
          <Effort data={data} />
          <Card
            title="Sessions"
            subtitle={
              s.sessions > data.table.length
                ? `Latest ${GYM_TABLE_LIMIT} of ${s.sessions} in this range`
                : `${plural(s.sessions, 'session')} in this range · open one for its heart-rate curve`
            }
          >
            <WorkoutTable rows={data.table} showYear={data.table.some((w) => w.date.slice(0, 4) !== data.range.to.slice(0, 4))} />
          </Card>
        </>
      )}
    </>
  )
}

function TrainingTime({ data }: { data: GymData }) {
  const t = useTokens()
  const monthly = data.bucket === 'month'

  const option = useMemo<EChartsOption>(() => {
    const labels = data.buckets.map((b) => (monthly ? (b.start.slice(5, 7) === '01' ? b.start.slice(0, 4) : fmtMonth(b.start)) : fmtDayMonth(b.start)))
    // Past two years of months only the Januaries are labelled, with their year.
    const yearsOnly = monthly && data.buckets.length > 24
    return {
      ...baseOption(t),
      tooltip: tooltip(t, {
        formatter: (params: unknown) => {
          const b = data.buckets[tipIndex(params)]
          const head = tipHead(monthly ? `${fmtMonth(b.start)} ${b.start.slice(0, 4)}` : `Week of ${fmtDayMonth(b.start)}`)
          if (b.sessions === 0) return head + tipNote(t, 'No sessions')
          return head + tipRow(t.cat.strength, 'Time', fmtHoursMin(b.durationS)) + tipNote(t, plural(b.sessions, 'session'))
        }
      }),
      xAxis: categoryAxis(t, labels, {
        axisLabel: {
          color: t.muted,
          fontSize: 12,
          hideOverlap: true,
          ...(yearsOnly ? { interval: (i: number) => data.buckets[i].start.slice(5, 7) === '01' } : {})
        }
      }),
      yAxis: valueAxis(t, {
        minInterval: 0.5,
        axisLabel: { color: t.muted, fontSize: 12, formatter: (v: number) => (v === 0 ? '0' : `${v} h`) }
      }),
      series: barSeries(
        'Time',
        t.cat.strength,
        data.buckets.map((b) => Math.round((b.durationS / 3600) * 100) / 100)
      )
    }
  }, [t, data, monthly])

  return (
    <Card
      title="Training time"
      subtitle={`Hours in the gym per ${monthly ? 'month' : 'week'}`}
      className="flex-[2] basis-[480px]"
    >
      <Chart option={option} ariaLabel={`Column chart of hours of gym training per ${monthly ? 'month' : 'week'} in the selected range`} />
    </Card>
  )
}

function WeekdayPattern({ data }: { data: GymData }) {
  const t = useTokens()
  const option = useMemo<EChartsOption>(
    () => ({
      ...baseOption(t),
      tooltip: tooltip(t, {
        formatter: (params: unknown) => {
          const i = tipIndex(params)
          return tipHead(WEEKDAYS_LONG[i]) + tipRow(t.cat.strength, 'Sessions', String(data.weekdays[i]))
        }
      }),
      xAxis: categoryAxis(t, WEEKDAYS),
      yAxis: valueAxis(t, { minInterval: 1 }),
      series: barSeries('Sessions', t.cat.strength, data.weekdays)
    }),
    [t, data]
  )
  const busiest = Math.max(...data.weekdays)
  const top = data.weekdays.flatMap((n, i) => (n === busiest && n > 0 ? [WEEKDAYS_LONG[i]] : []))
  return (
    <Card
      title="Training days"
      subtitle={top.length === 1 ? `Sessions by weekday · most often on ${top[0]}` : 'Sessions by weekday'}
      className="flex-1 basis-[300px]"
    >
      <Chart option={option} ariaLabel="Column chart of the number of gym sessions on each day of the week" />
    </Card>
  )
}

/** Three charts on one shared x-axis: the sessions that carry at least one effort measure. */
function Effort({ data }: { data: GymData }) {
  const t = useTokens()
  const navigate = useNavigate()

  const measured = useMemo(() => data.sessions.filter((s) => s.avgHr != null || s.energyKcal != null || s.effort != null), [data])
  const unmeasured = data.sessions.length - measured.length
  const s = data.summary

  const charts = useMemo(() => {
    const spansYears = measured.length > 0 && measured[0].date.slice(0, 4) !== measured[measured.length - 1].date.slice(0, 4)
    const labels = measured.map((m) => (spansYears ? fmtDateYear(m.date) : fmtDayMonth(m.date)))
    const head = (m: GymSession): string => tipHead(`${fmtDateShort(m.date)} · ${m.name}`) + tipNote(t, fmtHoursMin(m.durationS))
    const base = (rows: (m: GymSession) => string): EChartsOption => ({
      ...baseOption(t),
      tooltip: tooltip(t, {
        formatter: (params: unknown) => {
          const m = measured[tipIndex(params)]
          return head(m) + `<div style="margin-top:4px">${rows(m)}</div>`
        }
      }),
      xAxis: categoryAxis(t, labels)
    })
    const missing = tipNote(t, 'Not recorded')

    const dots = (series: SeriesOption | SeriesOption[]): SeriesOption[] =>
      (Array.isArray(series) ? series : [series]).map((x) => ({ ...x, showSymbol: true, showAllSymbol: true, symbolSize: 7 }) as SeriesOption)

    const hr: EChartsOption = {
      ...base((m) =>
        m.avgHr == null
          ? missing
          : tipRow(t.cat.strength, 'Average', `${Math.round(m.avgHr)} bpm`) + (m.maxHr != null ? tipRow(t.ctx, 'Peak', `${Math.round(m.maxHr)} bpm`) : '')
      ),
      yAxis: valueAxis(t, niceScale(measured.flatMap((m) => [m.avgHr, m.maxHr]).filter((v): v is number => v != null))),
      series: [
        ...dots(lineSeries(t, 'Peak', t.ctx, measured.map((m) => (m.maxHr != null ? Math.round(m.maxHr) : null)))),
        ...dots(lineSeries(t, 'Average', t.cat.strength, measured.map((m) => (m.avgHr != null ? Math.round(m.avgHr) : null))))
      ]
    }

    const energy: EChartsOption = {
      ...base((m) => (m.energyKcal == null ? missing : tipRow(t.cat.strength, 'Active energy', `${fmtNumber(m.energyKcal)} kcal`))),
      yAxis: valueAxis(t),
      series: barSeries('Active energy', t.cat.strength, measured.map((m) => (m.energyKcal != null ? Math.round(m.energyKcal) : null)))
    }

    const effort: EChartsOption = {
      ...base((m) => (m.effort == null ? missing : tipRow(t.cat.strength, 'Effort', `${fmtNumber(m.effort, Number.isInteger(m.effort) ? 0 : 1)} of 10`))),
      yAxis: valueAxis(t, { min: 0, max: 10, interval: 5 }),
      series: barSeries('Effort', t.cat.strength, measured.map((m) => m.effort))
    }
    return { hr, energy, effort }
  }, [t, measured])

  const open = (p: { dataIndex?: number }): void => {
    const m = p.dataIndex != null ? measured[p.dataIndex] : undefined
    if (m) navigate(`/activities/${m.id}`)
  }

  if (measured.length === 0) {
    return (
      <Card title="Effort">
        <EmptyState title="No effort data in this range">
          Heart rate, energy and effort come from sessions recorded on an Apple Watch. The {plural(data.sessions.length, 'session')} here{' '}
          {data.sessions.length === 1 ? 'was' : 'were'} logged without one.
        </EmptyState>
      </Card>
    )
  }

  const without = (n: number): string => (n < measured.length ? ` · not recorded for ${measured.length - n}` : '')

  return (
    <>
      <section className="flex flex-wrap gap-4">
        <Card
          title="Heart rate"
          subtitle={s.hrSessions > 0 ? `Per session, in bpm${without(s.hrSessions)}` : 'Per session, in bpm'}
          className="flex-1 basis-[300px]"
        >
          {s.hrSessions > 0 ? (
            <>
              <Legend
                items={[
                  { color: t.cat.strength, label: 'Average' },
                  { color: t.ctx, label: 'Peak' }
                ]}
              />
              <Chart option={charts.hr} height={196} onClick={open} ariaLabel="Line chart of average and peak heart rate for each gym session" />
            </>
          ) : (
            <EmptyState title="No heart rate recorded">These sessions were logged without a heart-rate sensor.</EmptyState>
          )}
        </Card>
        <Card
          title="Active energy"
          subtitle={
            s.avgEnergyKcal != null ? `Per session, in kcal · ${fmtNumber(s.avgEnergyKcal)} on average${without(s.energySessions)}` : 'Per session, in kcal'
          }
          className="flex-1 basis-[300px]"
        >
          {s.energySessions > 0 ? (
            <Chart option={charts.energy} onClick={open} ariaLabel="Column chart of active energy burned in each gym session" />
          ) : (
            <EmptyState title="No energy recorded" />
          )}
        </Card>
        <Card
          title="Effort"
          subtitle={
            s.avgEffort != null ? `Apple's rating from 1 to 10 · ${fmtNumber(s.avgEffort, 1)} on average${without(s.effortSessions)}` : "Apple's rating from 1 to 10"
          }
          className="flex-1 basis-[300px]"
        >
          {s.effortSessions > 0 ? (
            <Chart option={charts.effort} onClick={open} ariaLabel="Column chart of Apple's effort score for each gym session" />
          ) : (
            <EmptyState title="No effort rating recorded" />
          )}
        </Card>
      </section>
      {unmeasured > 0 && (
        <div className="-mt-2 text-[13px] text-ink2">
          {plural(unmeasured, 'session')} in this range {unmeasured === 1 ? 'was' : 'were'} logged without heart rate, energy or an effort rating and{' '}
          {unmeasured === 1 ? 'is' : 'are'} left out of the three charts above.
        </div>
      )}
    </>
  )
}
