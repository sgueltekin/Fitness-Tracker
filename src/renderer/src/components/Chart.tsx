import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

/**
 * Thin ECharts wrapper. Build `option` with the helpers in lib/charts.ts so every
 * chart shares the same axes, grid, tooltip and mark styling.
 */
export function Chart({
  option,
  height = 220,
  className,
  onClick,
  ariaLabel
}: {
  option: EChartsOption
  height?: number
  className?: string
  /** Fires with the ECharts click params (params.dataIndex, params.seriesName, …). */
  onClick?: (params: echarts.ECElementEvent) => void
  /** One-sentence description of what the chart shows, for screen readers. */
  ariaLabel?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const clickRef = useRef(onClick)
  clickRef.current = onClick

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current, undefined, { renderer: 'svg' })
    chart.current = c
    c.on('click', (p) => clickRef.current?.(p as echarts.ECElementEvent))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, true)
  }, [option])

  return <div ref={el} role="img" aria-label={ariaLabel} className={className} style={{ height, width: '100%' }} />
}
