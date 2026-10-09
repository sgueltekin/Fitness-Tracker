import { useEffect, useState, type DependencyList } from 'react'
import type { Api } from '@shared/api'
import { useAppState } from './app-state'

export interface ApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Refetches without clearing the current data. */
  reload(): void
}

/**
 * Runs one API call and refetches when `deps` change or new data is imported.
 * While refetching, the previous data stays in place so the page does not flash.
 *
 *   const { data } = useApi((api) => api.getOverview(range), [range])
 */
export function useApi<T>(call: (api: Api) => Promise<T>, deps: DependencyList): ApiResult<T> {
  const { dataVersion } = useAppState()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    call(window.api).then(
      (d) => {
        if (!alive) return
        setData(d)
        setError(null)
        setLoading(false)
      },
      (err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    )
    return () => {
      alive = false
    }
    // `call` is intentionally not a dependency: callers pass an inline closure and list its inputs in `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion, tick])

  return { data, loading, error, reload: () => setTick((t) => t + 1) }
}
