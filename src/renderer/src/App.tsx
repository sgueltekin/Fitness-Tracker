import { HashRouter, Outlet, Route, Routes } from 'react-router-dom'
import { AppStateProvider, useAppState } from '@/lib/app-state'
import { Sidebar } from '@/components/Sidebar'
import { EmptyState } from '@/components/ui'
import Overview from '@/pages/Overview'
import Running from '@/pages/Running'
import Gym from '@/pages/Gym'
import Health from '@/pages/Health'
import Activities from '@/pages/Activities'
import WorkoutDetail from '@/pages/WorkoutDetail'
import RoutesPage from '@/pages/RoutesPage'
import Kit from '@/pages/Kit'

function Welcome() {
  const { startImport, importing } = useAppState()
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border border-line bg-surface p-8">
      <EmptyState title="Import your Apple Health data to get started">
        <ol className="m-0 mt-2 list-decimal pl-5 text-left">
          <li>On your iPhone, open Health and tap your profile picture.</li>
          <li>Choose “Export All Health Data” and wait for the zip.</li>
          <li>Move the zip to this PC, then choose it below.</li>
        </ol>
        <button
          type="button"
          onClick={() => void startImport()}
          disabled={importing}
          className="mt-5 min-h-11 rounded-[10px] border-0 bg-btn px-5 font-semibold text-btn-ink disabled:opacity-60"
        >
          {importing ? 'Importing…' : 'Choose export zip'}
        </button>
      </EmptyState>
    </div>
  )
}

function Layout({ bare = false }: { bare?: boolean }) {
  const { status } = useAppState()
  return (
    <div className="flex min-h-screen bg-page text-ink">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-5 px-8 pb-10 pt-7">
          {status && !status.hasData && !bare ? <Welcome /> : <Outlet />}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AppStateProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="running" element={<Running />} />
            <Route path="gym" element={<Gym />} />
            <Route path="health" element={<Health />} />
            <Route path="activities" element={<Activities />} />
            <Route path="activities/:id" element={<WorkoutDetail />} />
            <Route path="routes" element={<RoutesPage />} />
          </Route>
          <Route element={<Layout bare />}>
            <Route path="kit" element={<Kit />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppStateProvider>
  )
}
