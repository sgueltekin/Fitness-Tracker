import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { CATEGORY_LABEL, TRAINING_CATEGORIES } from '@shared/domain'
import { Chart } from '@/components/Chart'
import { MapView } from '@/components/MapView'
import { Card, CategoryTag, Legend, PageHeader, StatTile } from '@/components/ui'
import { baseOption, categoryAxis, lineSeries, stackedBarSeries, tipRow, valueAxis } from '@/lib/charts'
import { useTokens } from '@/lib/theme'

// Component gallery with made-up numbers. Not linked in the sidebar; open #/kit.
// It doubles as the reference for how pages are expected to use the shared pieces.
export default function Kit() {
  const t = useTokens()

  const weeks = ['7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct']
  const keys = TRAINING_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], color: t.cat[c] }))

  const stacked = useMemo<EChartsOption>(() => {
    const rows = [
      { walkrun: 40, easy: 50, strength: 60 },
      { easy: 60, intervals: 45, long: 80, strength: 96 },
      { easy: 59, long: 90, strength: 120 },
      { easy: 45, tempo: 41, long: 55, strength: 92 },
      { easy: 57, strength: 57, other: 20 }
    ]
    return {
      ...baseOption(t),
      tooltip: {
        ...baseOption(t).tooltip,
        formatter: (params: unknown) => {
          const list = params as { axisValue: string; seriesName: string; value: number; color: string }[]
          const rowsHtml = list
            .filter((p) => p.value > 0)
            .map((p) => tipRow(p.color, p.seriesName, `${p.value} min`))
            .join('')
          return `<div style="font-weight:600;margin-bottom:4px">Week of ${list[0].axisValue}</div>${rowsHtml}`
        }
      },
      xAxis: categoryAxis(t, weeks),
      yAxis: valueAxis(t, { axisLabel: { color: t.muted, formatter: (v: number) => (v === 0 ? '0' : `${v / 60} h`) }, interval: 60 }),
      series: stackedBarSeries(t, keys, rows)
    }
  }, [t])

  const line = useMemo<EChartsOption>(
    () => ({
      ...baseOption(t),
      xAxis: categoryAxis(t, weeks, { boundaryGap: false }),
      // Pace axis: smaller is faster, so the axis is inverted to put faster at the top.
      yAxis: valueAxis(t, {
        inverse: true,
        min: 540,
        max: 600,
        interval: 30,
        axisLabel: { color: t.muted, formatter: (v: number) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` }
      }),
      series: lineSeries(t, 'Easy pace', t.cat.easy, [592, 585, null, 571, 566], { endLabel: '9:26 /km' })
    }),
    [t]
  )

  return (
    <>
      <PageHeader title="Component kit" subtitle="Made-up numbers, for development" />
      <section className="flex flex-wrap gap-4">
        <StatTile label="Distance · last 7 days" value="21.4" unit="km" delta={{ text: '▲ 12%', tone: 'good' }} sub="vs previous 7 days" spark={[8, 12, 10, 16, 19, 21]} />
        <StatTile label="Resting heart rate" value="58" unit="bpm" delta={{ text: '▼ 2 bpm', tone: 'good' }} sub="vs previous 4 weeks" />
        <StatTile label="Longest run" value="10.0" unit="km" sub="Sun 4 Oct · 1:06:42" />
      </section>
      <section className="flex flex-wrap gap-4">
        <Card title="Stacked columns" subtitle="Hours per week by session type" className="flex-[2] basis-[480px]">
          <Legend items={keys.map((k) => ({ color: k.color, label: k.label }))} />
          <Chart option={stacked} ariaLabel="Example stacked column chart" />
        </Card>
        <Card title="Line with end label" subtitle="Weekly average in min/km · faster is higher" className="flex-1 basis-[300px]">
          <Chart option={line} ariaLabel="Example line chart" />
          <CategoryTag category="easy" />
        </Card>
      </section>
      <Card title="Map">
        <MapView
          height={360}
          lines={[
            { id: 1, coords: [[13.3777, 52.5163], [13.3690, 52.5145], [13.3501, 52.5145], [13.3505, 52.5100], [13.3700, 52.5108], [13.3777, 52.5163]] }
          ]}
          markers={[{ coord: [13.3777, 52.5163], kind: 'start' }]}
        />
      </Card>
    </>
  )
}
