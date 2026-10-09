import { Link } from 'react-router-dom'
import type { WorkoutSummary } from '@shared/api/common'
import { fmtDateShort, fmtDateYear, fmtDuration, fmtKm, fmtPace } from '@shared/format'
import { CategoryTag } from './ui'

const COLS = 'grid grid-cols-[104px_minmax(0,2fr)_repeat(5,minmax(0,1fr))] gap-3'

/**
 * The workout list used on every page. Each name links to the workout's detail page.
 * `showYear` switches the date column from 'Thu 8 Oct' to '8 Oct 2026' for lists that span years.
 */
export function WorkoutTable({ rows, showYear = false }: { rows: WorkoutSummary[]; showYear?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]" role="table" aria-label="Workouts">
        <div role="row" className={`${COLS} border-b border-axis py-2 text-xs text-muted`}>
          <div role="columnheader">Date</div>
          <div role="columnheader">Activity</div>
          <div role="columnheader">Type</div>
          <div role="columnheader" className="text-right">Distance</div>
          <div role="columnheader" className="text-right">Time</div>
          <div role="columnheader" className="text-right">Pace</div>
          <div role="columnheader" className="text-right">Avg HR</div>
        </div>
        {rows.map((w) => (
          <div key={w.id} role="row" className={`${COLS} tnum min-h-11 items-center border-b border-grid`}>
            <div role="cell" className="text-ink2">{showYear ? fmtDateYear(w.date) : fmtDateShort(w.date)}</div>
            <div role="cell" className="min-w-0">
              <Link
                to={`/activities/${w.id}`}
                className="inline-flex min-h-11 max-w-full items-center font-semibold text-ink no-underline hover:underline"
              >
                <span className="truncate">{w.name}</span>
              </Link>
            </div>
            <div role="cell"><CategoryTag category={w.category} /></div>
            <div role="cell" className="text-right">{w.distanceM ? `${fmtKm(w.distanceM)} km` : '–'}</div>
            <div role="cell" className="text-right">{fmtDuration(w.durationS)}</div>
            <div role="cell" className="text-right">{w.paceSPerKm ? `${fmtPace(w.paceSPerKm)} /km` : '–'}</div>
            <div role="cell" className="text-right">{w.avgHr ? Math.round(w.avgHr) : '–'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
