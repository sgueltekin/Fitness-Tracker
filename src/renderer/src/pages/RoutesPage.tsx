import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Compass, LonLat, RouteArea, RouteGroup, RouteShape, RoutesData } from '@shared/api/routes'
import type { Ymd } from '@shared/dates'
import { fmtDateYear, fmtDayMonth, fmtKm, fmtNumber, fmtPace } from '@shared/format'
import { MapView, type MapLine, type MapMarker } from '@/components/MapView'
import { Card, EmptyState, PageHeader, PageState, Segmented, StatTile } from '@/components/ui'
import { WorkoutTable } from '@/components/WorkoutTable'
import { useAppState } from '@/lib/app-state'
import { useTokens } from '@/lib/theme'
import { useApi } from '@/lib/useApi'

// Routes have no names in the data and the app cannot look places up, so a route is described
// by what its track shows: typical length, shape, and where it lies as seen from its start.
const SHAPE_LABEL: Record<RouteShape, string> = {
  loop: 'loop',
  laps: 'in laps',
  'out-and-back': 'out-and-back',
  'one-way': 'one-way'
}

const COMPASS_LABEL: Record<Compass, string> = {
  N: 'north',
  NE: 'north-east',
  E: 'east',
  SE: 'south-east',
  S: 'south',
  SW: 'south-west',
  W: 'west',
  NW: 'north-west'
}

function routeName(g: RouteGroup): string {
  return `${fmtKm(g.distanceM)} km ${SHAPE_LABEL[g.shape]}`
}

function areaName(a: RouteArea): string {
  return a.offset ? `${fmtNumber(Math.max(1, a.offset.distanceM / 1000))} km ${COMPASS_LABEL[a.offset.heading]}` : 'Usual area'
}

function runs(n: number): string {
  return n === 1 ? '1 run' : `${fmtNumber(n)} runs`
}

/**
 * Opacity of one run's line. Lines are translucent, so a stretch run several times stacks up
 * and reads stronger. With more runs on the map each line gets fainter, so that busy stretches
 * do not all end up solid: about `steps` overlapping runs reach 90%.
 */
function lineOpacity(runCount: number): number {
  const steps = Math.min(12, Math.max(3, runCount / 4))
  return 1 - Math.pow(0.1, 1 / steps)
}

/** Lines of other routes fade to this share of their opacity while one route is selected. */
const DIMMED = 0.4
/** Routes listed before "Show all". */
const TOP_ROUTES = 6
const NO_MARKERS: MapMarker[] = []

export default function RoutesPage() {
  const { range } = useAppState()
  const { data, loading, error } = useApi((api) => api.getRoutes(range), [range])

  return (
    <>
      <PageHeader title="Routes" subtitle="Everywhere you have run with GPS" />
      <PageState loading={loading} error={error} hasData={data != null}>
        {data &&
          (data.runs.length === 0 ? (
            <Card>
              <EmptyState title="No GPS-recorded runs in this range">
                {data.runCount > 0
                  ? `${runs(data.runCount)} in this range, none with a recorded route. Pick a longer range to see earlier runs.`
                  : 'Pick a longer range to see earlier runs.'}
              </EmptyState>
            </Card>
          ) : (
            <RoutesView data={data} />
          ))}
      </PageState>
    </>
  )
}

function RoutesView({ data }: { data: RoutesData }) {
  const t = useTokens()
  const [params, setParams] = useSearchParams()
  const [areaChoice, setAreaChoice] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  // The selection lives in the URL (#/routes?route=<key>), so it survives a trip to a run's page and back.
  const routeParam = params.get('route')
  const selected = (routeParam !== null && data.groups.find((g) => String(g.key) === routeParam)) || null
  // One area is on the map at a time: the selected route's, else the one picked, else the busiest.
  const area = selected?.area ?? data.areas.find((a) => a.key === areaChoice)?.key ?? data.areas[0].key

  function setRouteParam(key: number | null): void {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (key === null) next.delete('route')
        else next.set('route', String(key))
        return next
      },
      { replace: true }
    )
  }

  function select(group: RouteGroup | null): void {
    if (group) setAreaChoice(group.area)
    setRouteParam(group ? group.key : null)
  }

  function showArea(key: number): void {
    setAreaChoice(key)
    if (selected && selected.area !== key) setRouteParam(null)
  }

  const selectedKey = selected?.key ?? null
  const lines = useMemo<MapLine[]>(() => {
    const groupOf = new Map(data.groups.map((g) => [g.key, g]))
    const here = data.runs.filter((r) => groupOf.get(r.group)?.area === area)
    const opacity = lineOpacity(here.length)
    // Where lines overlap a click takes the top one, so the most-run routes go on top.
    const ordered = [...here].sort((a, b) => (groupOf.get(a.group)?.runs ?? 0) - (groupOf.get(b.group)?.runs ?? 0))
    const out: MapLine[] = ordered.map((r) => ({
      id: r.workout.id,
      coords: r.coords,
      color: t.seq[2],
      opacity: selectedKey !== null && r.group !== selectedKey ? opacity * DIMMED : opacity,
      width: 3
    }))
    const outline = selectedKey !== null ? groupOf.get(selectedKey)?.outline : undefined
    if (outline && outline.length > 1) {
      out.push({ id: 'selected-casing', coords: outline, color: t.surface, opacity: 0.9, width: 7 })
      out.push({ id: 'selected', coords: outline, color: t.ink, opacity: 1, width: 3 })
    }
    return out
  }, [data, area, selectedKey, t])

  // Kept stable so MapView does not redraw on every render.
  const markers = useMemo<MapMarker[]>(() => {
    const outline = data.groups.find((g) => g.key === selectedKey)?.outline
    return outline && outline.length > 0 ? [{ coord: outline[0], kind: 'start' }] : NO_MARKERS
  }, [data, selectedKey])

  function onLineClick(id: string | number): void {
    const run = data.runs.find((r) => r.workout.id === id)
    const group = run && data.groups.find((g) => g.key === run.group)
    if (group) select(group)
  }

  const spansYears = data.runs[0].workout.date.slice(0, 4) !== data.to.slice(0, 4)
  const day = (d: Ymd): string => (d.slice(0, 4) === data.to.slice(0, 4) ? fmtDayMonth(d) : fmtDateYear(d))

  const maxRuns = data.groups[0].runs
  const top = data.groups.slice(0, TOP_ROUTES)
  // A route picked on the map stays visible in the short list even when it is not among the top ones.
  const listed = showAll ? data.groups : selected && !top.includes(selected) ? [...top, selected] : top
  const hidden = data.groups.length - top.length

  const opacity = lineOpacity(data.runs.filter((r) => data.groups.find((g) => g.key === r.group)?.area === area).length)
  const mappedKm = data.mappedDistanceM / 1000
  const selectedRuns = selected ? data.runs.filter((r) => r.group === selected.key) : []
  const selectedKm = selectedRuns.flatMap((r) => r.workout.distanceM ?? []).sort((a, b) => a - b)

  return (
    <>
      <section className="flex flex-wrap gap-4">
        <div
          role="group"
          aria-label="Map of GPS-recorded runs"
          className="@container relative max-h-[820px] min-h-[min(640px,80vh)] min-w-0 flex-[3] basis-[520px]"
        >
          <MapView lines={lines} markers={markers} height="100%" className="absolute inset-0" onLineClick={onLineClick} />
          {data.areas.length > 1 && (
            <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-64px)]">
              <AreaPicker areas={data.areas} value={area} onChange={showArea} />
            </div>
          )}
          {/* On a narrow map the legend sits above the attribution instead of beside it. */}
          <div className="absolute bottom-11 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap @[660px]:bottom-3 @[660px]:max-w-[calc(100%-360px)] items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink2">
            <span className="inline-flex items-center gap-2">
              Fewer runs
              <span className="inline-flex gap-0.5" aria-hidden="true">
                {[1, 3, 12].map((n) => (
                  <span
                    key={n}
                    className="h-1 w-[18px] rounded-sm"
                    style={{ background: t.seq[2], opacity: 1 - Math.pow(1 - opacity, n) }}
                  />
                ))}
              </span>
              More runs
            </span>
            {selected && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1 w-[18px] rounded-sm bg-ink" aria-hidden="true" />
                Selected route
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 basis-[300px] flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <StatTile
              label="Runs with GPS"
              value={fmtNumber(data.runs.length)}
              sub={data.runCount > data.runs.length ? `of ${runs(data.runCount)}` : 'every run in this range'}
            />
            <StatTile
              label="Distance mapped"
              value={fmtNumber(mappedKm, mappedKm < 100 ? 1 : 0)}
              unit="km"
              sub={data.groups.length === 1 ? 'on 1 route' : `on ${fmtNumber(data.groups.length)} routes`}
            />
          </div>

          <Card
            title="Most-run routes"
            subtitle="Runs grouped by matching GPS track, named by length, shape and direction from the start"
            className="flex-1"
          >
            <ul className="m-0 -mx-2 flex list-none flex-col p-0">
              {listed.map((g) => (
                <RouteRow
                  key={g.key}
                  group={g}
                  area={g.area !== 0 ? data.areas.find((a) => a.key === g.area) : undefined}
                  share={g.runs / maxRuns}
                  lastRun={day(g.lastDate)}
                  active={g === selected}
                  onClick={() => select(g === selected ? null : g)}
                />
              ))}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
                className="min-h-9 self-start rounded-[7px] border border-line bg-transparent px-3 font-medium text-ink2 hover:text-ink"
              >
                {showAll ? `Show the top ${TOP_ROUTES} only` : `Show all ${fmtNumber(data.groups.length)} routes`}
              </button>
            )}
            {!selected && (
              <div className="text-[13px] text-muted">Select a route here, or click a line on the map, to highlight it and list its runs.</div>
            )}
          </Card>
        </div>
      </section>

      {selected && (
        <Card
          title={selected.heading ? `${routeName(selected)} · ${COMPASS_LABEL[selected.heading]}` : routeName(selected)}
          subtitle={[
            `${runs(selected.runs)} in this range`,
            selectedKm.length > 0 &&
              (fmtKm(selectedKm[0]) === fmtKm(selectedKm[selectedKm.length - 1])
                ? `${fmtKm(selectedKm[0])} km`
                : `${fmtKm(selectedKm[0])} to ${fmtKm(selectedKm[selectedKm.length - 1])} km`),
            selected.bestPaceSPerKm !== null && `best pace ${fmtPace(selected.bestPaceSPerKm)} /km`
          ]
            .filter(Boolean)
            .join(' · ')}
          action={
            <button
              type="button"
              onClick={() => select(null)}
              className="min-h-9 rounded-[7px] border border-line bg-transparent px-3 font-medium text-ink2 hover:text-ink"
            >
              Clear selection
            </button>
          }
        >
          <WorkoutTable rows={selectedRuns.map((r) => r.workout).reverse()} showYear={spansYears} />
        </Card>
      )}
    </>
  )
}

function RouteRow({
  group,
  area,
  share,
  lastRun,
  active,
  onClick
}: {
  group: RouteGroup
  /** Set for routes outside the usual area. */
  area?: RouteArea
  /** 0..1, runs relative to the most-run route. */
  share: number
  lastRun: string
  active: boolean
  onClick(): void
}) {
  return (
    <li className="border-t border-grid">
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`my-0.5 flex w-full items-center gap-3 rounded-lg border-0 px-2 py-2.5 text-left text-ink ${
          active ? 'bg-sunk' : 'bg-transparent hover:bg-sunk'
        }`}
      >
        <RouteGlyph outline={group.outline} />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0">
              <span className="font-semibold">{routeName(group)}</span>
              {group.heading && <span className="text-ink2"> · {COMPASS_LABEL[group.heading]}</span>}
            </span>
            <span className="tnum shrink-0 text-[13px] text-ink2">{runs(group.runs)}</span>
          </span>
          <span
            className="block h-1.5 rounded-r-[3px]"
            style={{ width: `${Math.max(2, share * 100)}%`, background: 'var(--seq-3)' }}
            aria-hidden="true"
          />
          <span className="text-[13px] text-ink2">
            {group.bestPaceSPerKm !== null && `best ${fmtPace(group.bestPaceSPerKm)} /km · `}
            last run {lastRun}
            {area?.offset && ` · ${areaName(area)} of your usual area`}
          </span>
        </span>
      </button>
    </li>
  )
}

/** The route's shape, north up, as a small neutral drawing with a dot at the start. */
function RouteGlyph({ outline, size = 40 }: { outline: LonLat[]; size?: number }) {
  const { d, start } = useMemo(() => glyph(outline, size, 4), [outline, size])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 text-ink2" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {start && <circle cx={start[0]} cy={start[1]} r={2.5} fill="currentColor" />}
    </svg>
  )
}

function glyph(outline: LonLat[], size: number, pad: number): { d: string; start: [number, number] | null } {
  if (outline.length < 2) return { d: '', start: null }
  let minLat = Infinity
  let maxLat = -Infinity
  for (const [, lat] of outline) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  // Degrees of longitude are shorter than degrees of latitude away from the equator.
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const xs = outline.map(([lon]) => lon * kx)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const scale = (size - 2 * pad) / Math.max(maxX - minX, maxLat - minLat, 1e-9)
  const ox = (size - (maxX - minX) * scale) / 2
  const oy = (size - (maxLat - minLat) * scale) / 2
  const pts = outline.map(([, lat], i): [number, number] => [ox + (xs[i] - minX) * scale, oy + (maxLat - lat) * scale])
  return { d: pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''), start: pts[0] }
}

function AreaPicker({ areas, value, onChange }: { areas: RouteArea[]; value: number; onChange(key: number): void }) {
  const options = areas.map((a) => ({ key: String(a.key), label: `${areaName(a)} (${runs(a.runs)})` }))
  if (areas.length === 2) {
    return <Segmented label="Area shown on the map" options={options} value={String(value)} onChange={(k) => onChange(Number(k))} />
  }
  return (
    <select
      aria-label="Area shown on the map"
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      className="min-h-9 max-w-full rounded-[10px] border border-line bg-surface px-3 font-medium text-ink"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
