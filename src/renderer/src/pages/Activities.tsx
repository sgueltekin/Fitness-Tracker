import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom'
import { SPORT_LABEL, type Sport } from '@shared/domain'
import { fmtDateYear, fmtHoursMin, fmtNumber } from '@shared/format'
import { WorkoutTable } from '@/components/WorkoutTable'
import { Card, EmptyState, PageHeader, PageState, Segmented } from '@/components/ui'
import { useApi } from '@/lib/useApi'

/** Rows shown at first and added by each "Show more". */
const PAGE_SIZE = 100

// Where the list was scrolled to, so that coming back from a workout lands on the same row.
// Tagged with the filters it belongs to; a different list starts at the top.
let lastScroll: { search: string; y: number } | null = null

function isSport(v: string | null): v is Sport {
  return v != null && v in SPORT_LABEL
}

/**
 * Every workout, newest first. Sport, search text and the number of rows shown live in the URL
 * (#/activities?sport=run&q=lauf&n=200), so Back from a workout returns to the same list.
 */
export default function Activities() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navType = useNavigationType()

  const sportParam = params.get('sport')
  const sport: Sport | 'all' = isSport(sportParam) ? sportParam : 'all'
  const search = params.get('q') ?? ''
  const shownParam = Number(params.get('n'))
  const shown = Number.isInteger(shownParam) && shownParam > 0 ? shownParam : PAGE_SIZE

  const { data, loading, error } = useApi((api) => api.getActivities({ sport, search, limit: shown }), [sport, search, shown])

  /** Filters replace the history entry: Back should leave the page, not undo keystrokes. */
  function update(next: { sport?: Sport | 'all'; q?: string; n?: number }): void {
    const merged = { sport, q: search, n: PAGE_SIZE, ...next }
    const p = new URLSearchParams()
    if (merged.sport !== 'all') p.set('sport', merged.sport)
    if (merged.q) p.set('q', merged.q)
    if (merged.n !== PAGE_SIZE) p.set('n', String(merged.n))
    setParams(p, { replace: true })
  }

  // Read before the scroll listener below can overwrite it.
  const [restoreTo] = useState(() => (navType === 'POP' && lastScroll?.search === location.search ? lastScroll.y : 0))
  const restored = useRef(false)

  useLayoutEffect(() => {
    const onScroll = (): void => {
      lastScroll = { search: location.search, y: window.scrollY }
    }
    // Start from the current position, so an entry left over from an earlier visit cannot be restored.
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [location.search])

  // The page is only tall enough to scroll once the rows are there.
  useLayoutEffect(() => {
    if (!data || restored.current) return
    restored.current = true
    window.scrollTo(0, restoreTo)
  }, [data, restoreTo])

  const sportOptions: { key: Sport | 'all'; label: string }[] = [
    { key: 'all', label: 'All' },
    ...(data?.sports ?? []).map((s) => ({ key: s, label: SPORT_LABEL[s] }))
  ]
  const filtered = sport !== 'all' || search.trim() !== ''

  return (
    <>
      <PageHeader
        title="Activities"
        subtitle={
          data?.firstDate
            ? `${fmtNumber(data.allCount)} workout${data.allCount === 1 ? '' : 's'} since ${fmtDateYear(data.firstDate)}`
            : undefined
        }
        right={
          <div className="flex max-w-full flex-wrap items-center gap-3">
            {data && (
              <div className="max-w-full overflow-x-auto">
                <Segmented label="Sport" options={sportOptions} value={sport} onChange={(key) => update({ sport: key })} />
              </div>
            )}
            <input
              type="search"
              value={search}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search name, type or date"
              aria-label="Search workouts by name, type or date"
              className="min-h-11 w-60 rounded-[10px] border border-line bg-surface px-3.5 text-ink placeholder:text-muted"
            />
          </div>
        }
      />
      <PageState loading={loading} error={error} hasData={data != null}>
        {data && (
          <Card
            title={
              filtered
                ? `${fmtNumber(data.total)} of ${fmtNumber(data.allCount)} workouts`
                : 'All workouts'
            }
            subtitle={
              data.total > 0
                ? [data.totalDistanceM > 0 ? `${fmtNumber(data.totalDistanceM / 1000, 1)} km` : null, fmtHoursMin(data.totalDurationS)]
                    .filter(Boolean)
                    .join(' · ')
                : undefined
            }
          >
            {data.total === 0 ? (
              <EmptyState title="No workouts match">
                <div>
                  {search.trim() ? `Nothing matches “${search.trim()}”` : 'Nothing here'}
                  {sport !== 'all' ? ` in ${SPORT_LABEL[sport]}` : ''}.
                </div>
                <button
                  type="button"
                  onClick={() => update({ sport: 'all', q: '' })}
                  className="mt-3 min-h-11 rounded-[10px] border border-axis bg-surface px-[18px] font-semibold text-ink"
                >
                  Clear filters
                </button>
              </EmptyState>
            ) : (
              <>
                <WorkoutTable rows={data.rows} showYear />
                {data.rows.length < data.total && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[13px] text-ink2">
                      Showing {fmtNumber(data.rows.length)} of {fmtNumber(data.total)}
                    </div>
                    <button
                      type="button"
                      onClick={() => update({ n: shown + PAGE_SIZE })}
                      className="min-h-11 rounded-[10px] border border-axis bg-surface px-[18px] font-semibold text-ink"
                    >
                      Show {Math.min(PAGE_SIZE, data.total - data.rows.length)} more
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        )}
      </PageState>
    </>
  )
}
