import type { EChartsOption } from 'echarts'
import type { Tokens } from './theme'

// Shared chart styling. Rules these helpers encode:
//  - one y-axis per chart; two measures get two charts side by side
//  - gridlines and axes are solid hairlines one step off the surface
//  - bars are at most 22px thick, rounded only at the data end
//  - stacked segments are separated by a surface-coloured gap, not an outline
//  - lines are 2px; text never takes a series colour

type XAxis = Extract<NonNullable<EChartsOption['xAxis']>, { type?: 'category' }>
type YAxis = Extract<NonNullable<EChartsOption['yAxis']>, { type?: 'value' }>

/** Top-level option fields every chart starts from. Spread it first, then add axes and series. */
export function baseOption(t: Tokens): EChartsOption {
  return {
    animationDuration: 250,
    textStyle: { fontFamily: t.fontFamily, color: t.ink2, fontSize: 12 },
    grid: { left: 4, right: 12, top: 18, bottom: 2, containLabel: true },
    tooltip: tooltip(t)
  }
}

export function tooltip(t: Tokens, extra: Record<string, unknown> = {}): EChartsOption['tooltip'] {
  return {
    trigger: 'axis',
    axisPointer: { type: 'line', lineStyle: { color: t.axis, width: 1, type: 'solid' } },
    backgroundColor: t.surface,
    borderColor: t.line,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.ink, fontFamily: t.fontFamily, fontSize: 13 },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px;',
    ...extra
  }
}

export function categoryAxis(t: Tokens, labels: string[], extra: Partial<XAxis> = {}): XAxis {
  return {
    type: 'category',
    data: labels,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 12, hideOverlap: true },
    ...extra
  } as XAxis
}

export function valueAxis(t: Tokens, extra: Partial<YAxis> = {}): YAxis {
  return {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: t.grid, type: 'solid' } },
    axisLabel: { color: t.muted, fontSize: 12 },
    splitNumber: 3,
    ...extra
  } as YAxis
}

export interface StackKey {
  key: string
  label: string
  color: string
}

/**
 * Series for a stacked column chart. `rows[i][key]` is the value of that key in column i.
 * Only the topmost non-zero segment of each column gets rounded corners.
 */
export function stackedBarSeries(t: Tokens, keys: StackKey[], rows: Record<string, number | undefined>[]): EChartsOption['series'] {
  const top = rows.map((row) => {
    let last = -1
    keys.forEach((k, i) => {
      if ((row[k.key] ?? 0) > 0) last = i
    })
    return last
  })
  return keys.map((k, ki) => ({
    name: k.label,
    type: 'bar' as const,
    stack: 'total',
    barMaxWidth: 22,
    itemStyle: { color: k.color, borderColor: t.surface, borderWidth: 1 },
    emphasis: { disabled: true },
    data: rows.map((row, ri) => ({
      value: row[k.key] ?? 0,
      itemStyle: { borderRadius: top[ri] === ki ? [4, 4, 0, 0] : 0 }
    }))
  }))
}

/** Series for a single-colour column chart. */
export function barSeries(name: string, color: string, data: (number | null)[]): NonNullable<EChartsOption['series']> {
  return [
    {
      name,
      type: 'bar',
      barMaxWidth: 22,
      itemStyle: { color, borderRadius: [4, 4, 0, 0] },
      emphasis: { disabled: true },
      data
    }
  ]
}

/**
 * Series for a line. Nulls break the line. The last non-null point gets a dot
 * with a surface-coloured ring; pass `endLabel` to print its value beside it.
 */
export function lineSeries(
  t: Tokens,
  name: string,
  color: string,
  data: (number | null)[],
  opts: { endLabel?: string; area?: boolean; connectNulls?: boolean } = {}
): NonNullable<EChartsOption['series']> {
  let lastIdx = -1
  data.forEach((v, i) => {
    if (v != null) lastIdx = i
  })
  return [
    {
      name,
      type: 'line',
      data,
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 8,
      connectNulls: opts.connectNulls ?? false,
      lineStyle: { color, width: 2, join: 'round', cap: 'round' },
      itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
      areaStyle: opts.area ? { color, opacity: 0.1 } : undefined,
      emphasis: { disabled: true },
      markPoint:
        lastIdx >= 0
          ? {
              symbol: 'circle',
              symbolSize: 10,
              silent: true,
              itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
              label: opts.endLabel
                ? { show: true, formatter: opts.endLabel, position: 'top', align: 'right', offset: [6, 0], color: t.ink, fontWeight: 600, fontSize: 13 }
                : { show: false },
              data: [{ name: 'latest', coord: [lastIdx, data[lastIdx] as number] }]
            }
          : undefined
    }
  ]
}

/** Tooltip row markup with a square colour key, for custom tooltip formatters. */
export function tipRow(color: string, label: string, value: string): string {
  return (
    `<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:150px">` +
    `<span style="display:inline-flex;align-items:center;gap:6px">` +
    `<span style="width:10px;height:10px;border-radius:3px;background:${color}"></span>${label}</span>` +
    `<span style="font-weight:600;font-variant-numeric:tabular-nums">${value}</span></div>`
  )
}
