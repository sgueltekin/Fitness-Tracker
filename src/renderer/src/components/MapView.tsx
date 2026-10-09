import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
// MapLibre only finds its worker on its own when served over http; in the packaged app we hand it the bundled file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import { useTokens } from '@/lib/theme'

export interface MapLine {
  id: string | number
  /** [lon, lat] pairs. */
  coords: [number, number][]
  color?: string
  /** 0..1 */
  opacity?: number
  width?: number
}

export interface MapMarker {
  coord: [number, number]
  kind: 'start' | 'end'
}

maplibregl.setWorkerUrl(workerUrl)

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark'

/**
 * Map with route lines drawn on free OpenFreeMap tiles. Fits itself to the lines.
 * Lines are drawn in array order, so put the ones that should sit on top last.
 * Without a network connection the tiles stay blank but the lines still draw.
 */
export function MapView({
  lines,
  markers = [],
  height = 420,
  className = '',
  onLineClick
}: {
  lines: MapLine[]
  markers?: MapMarker[]
  height?: number | string
  className?: string
  onLineClick?: (id: string | number) => void
}) {
  const t = useTokens()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const clickRef = useRef(onLineClick)
  clickRef.current = onLineClick
  // Latest props for the style.load handler, which outlives the render that created it.
  const latest = useRef({ lines, markers, t })
  latest.current = { lines, markers, t }

  function draw(m: maplibregl.Map): void {
    const { lines, markers, t } = latest.current
    const lineData: FeatureCollection<LineString> = {
      type: 'FeatureCollection',
      features: lines
        .filter((l) => l.coords.length > 1)
        .map(
          (l): Feature<LineString> => ({
            type: 'Feature',
            properties: { id: l.id, color: l.color ?? t.cat.easy, opacity: l.opacity ?? 0.9, width: l.width ?? 4 },
            geometry: { type: 'LineString', coordinates: l.coords }
          })
        )
    }
    const markerData: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: markers.map(
        (mk): Feature<Point> => ({
          type: 'Feature',
          properties: { fill: mk.kind === 'start' ? t.surface : t.ink, stroke: mk.kind === 'start' ? t.ink : t.surface },
          geometry: { type: 'Point', coordinates: mk.coord }
        })
      )
    }

    const lineSrc = m.getSource('fd-lines') as maplibregl.GeoJSONSource | undefined
    if (lineSrc) {
      lineSrc.setData(lineData)
      ;(m.getSource('fd-markers') as maplibregl.GeoJSONSource).setData(markerData)
    } else {
      m.addSource('fd-lines', { type: 'geojson', data: lineData })
      m.addLayer({
        id: 'fd-lines',
        type: 'line',
        source: 'fd-lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': ['get', 'opacity'],
          'line-width': ['get', 'width']
        }
      })
      m.addSource('fd-markers', { type: 'geojson', data: markerData })
      m.addLayer({
        id: 'fd-markers',
        type: 'circle',
        source: 'fd-markers',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'fill'],
          'circle-stroke-color': ['get', 'stroke'],
          'circle-stroke-width': 2
        }
      })
    }
  }

  function fit(m: maplibregl.Map, animate: boolean): void {
    const pts = latest.current.lines.flatMap((l) => l.coords)
    if (pts.length === 0) return
    const b = new maplibregl.LngLatBounds(pts[0], pts[0])
    for (const p of pts) b.extend(p)
    m.fitBounds(b, { padding: 40, maxZoom: 16, animate })
  }

  useEffect(() => {
    if (!el.current) return
    const m = new maplibregl.Map({
      container: el.current,
      style: latest.current.t.dark ? STYLE_DARK : STYLE_LIGHT,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('style.load', () => draw(m))
    m.on('click', 'fd-lines', (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      if (id != null) clickRef.current?.(id)
    })
    m.on('mouseenter', 'fd-lines', () => {
      if (clickRef.current) m.getCanvas().style.cursor = 'pointer'
    })
    m.on('mouseleave', 'fd-lines', () => {
      m.getCanvas().style.cursor = ''
    })
    fit(m, false)
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  // Switch basemap with the system theme; style.load redraws the lines.
  useEffect(() => {
    map.current?.setStyle(t.dark ? STYLE_DARK : STYLE_LIGHT)
  }, [t.dark])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (m.isStyleLoaded()) draw(m)
    fit(m, false)
  }, [lines, markers])

  return (
    <div
      ref={el}
      className={`overflow-hidden rounded-xl border border-line bg-sunk ${className}`}
      style={{ height }}
    />
  )
}
