import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppStatus, ImportProgress, ImportSummary } from '@shared/api/status'
import type { RangeKey } from '@shared/dates'

interface AppState {
  /** Date range shared by every page. */
  range: RangeKey
  setRange(range: RangeKey): void
  /** Bumped after each import so data hooks refetch. */
  dataVersion: number
  status: AppStatus | null
  importing: boolean
  progress: ImportProgress | null
  lastSummary: ImportSummary | null
  importError: string | null
  /** Opens the file picker and imports the chosen export. */
  startImport(): Promise<void>
}

const Ctx = createContext<AppState | null>(null)

const RANGE_STORAGE_KEY = 'fd.range'

function storedRange(): RangeKey {
  try {
    const v = localStorage.getItem(RANGE_STORAGE_KEY)
    if (v === '4w' || v === '12w' || v === '6m' || v === '1y' || v === 'all') return v
  } catch {
    // storage unavailable: fall through to the default
  }
  return '12w'
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<RangeKey>(storedRange)
  const [dataVersion, setDataVersion] = useState(0)
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.getStatus().then((s) => alive && setStatus(s))
    return () => {
      alive = false
    }
  }, [dataVersion])

  useEffect(() => window.appEvents.onImportProgress(setProgress), [])

  const setRange = useCallback((r: RangeKey) => {
    setRangeState(r)
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, r)
    } catch {
      // not persisted; the choice still applies for this session
    }
  }, [])

  const startImport = useCallback(async () => {
    setImportError(null)
    setImporting(true)
    setProgress(null)
    try {
      const summary = await window.api.importExport()
      if (summary) {
        setLastSummary(summary)
        setDataVersion((v) => v + 1)
      }
    } catch (err) {
      // Electron prefixes IPC errors with "Error invoking remote method 'api': Error: ".
      const msg = err instanceof Error ? err.message : String(err)
      setImportError(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }, [])

  const value = useMemo<AppState>(
    () => ({ range, setRange, dataVersion, status, importing, progress, lastSummary, importError, startImport }),
    [range, setRange, dataVersion, status, importing, progress, lastSummary, importError, startImport]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppState must be used inside AppStateProvider')
  return v
}
