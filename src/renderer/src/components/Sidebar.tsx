import { NavLink } from 'react-router-dom'
import { fmtDayMonth } from '@shared/format'
import { ymd } from '@shared/dates'
import { useAppState } from '@/lib/app-state'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/running', label: 'Running' },
  { to: '/gym', label: 'Gym' },
  { to: '/health', label: 'Health' },
  { to: '/activities', label: 'Activities' },
  { to: '/routes', label: 'Routes' }
]

function importedLabel(importedAt: number): string {
  const d = new Date(importedAt)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const day = ymd(d) === ymd(new Date()) ? 'today' : fmtDayMonth(ymd(d))
  return `Last import ${day}, ${time}`
}

export function Sidebar() {
  const { status, importing, progress, importError, lastSummary, startImport } = useAppState()

  return (
    <nav className="sticky top-0 flex h-screen w-[216px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-3.5 py-6">
      <div className="px-3 pb-5 text-[17px] font-bold">Fitness Dashboard</div>

      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            `flex min-h-11 items-center rounded-lg px-3 no-underline ${
              isActive ? 'bg-sunk font-semibold text-ink' : 'font-medium text-ink2 hover:text-ink'
            }`
          }
        >
          {n.label}
        </NavLink>
      ))}

      <div className="mt-5 flex flex-col gap-3 border-t border-grid px-3 pt-4 text-[13px] text-ink2">
        <div>
          <div className="font-semibold text-ink">Apple Health</div>
          <div>{status?.lastImport ? importedLabel(status.lastImport.importedAt) : 'No data imported yet'}</div>
        </div>

        <button
          type="button"
          onClick={() => void startImport()}
          disabled={importing}
          className="min-h-11 rounded-[10px] border-0 bg-btn px-4 font-semibold text-btn-ink disabled:opacity-60"
        >
          {importing ? 'Importing…' : 'Refresh data'}
        </button>

        {importing && (
          <div aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
              <div
                className="h-full rounded-full bg-ink transition-[width]"
                style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }}
              />
            </div>
            <div className="mt-1">{progress?.message ?? 'Starting…'}</div>
          </div>
        )}
        {!importing && importError && (
          <div role="alert" className="text-down">
            Import failed: {importError}
          </div>
        )}
        {!importing && !importError && lastSummary && (
          <div aria-live="polite">
            {lastSummary.workoutsNew === 0
              ? 'No new workouts in that export.'
              : `${lastSummary.workoutsNew} new workout${lastSummary.workoutsNew === 1 ? '' : 's'} added.`}
          </div>
        )}
      </div>
    </nav>
  )
}
