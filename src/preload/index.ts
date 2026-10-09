import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, IMPORT_PROGRESS_CHANNEL, type Api } from '@shared/api'
import type { ImportProgress } from '@shared/api/status'

const api = Object.fromEntries(
  API_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke('api', method, args)])
) as unknown as Api

contextBridge.exposeInMainWorld('api', api)

contextBridge.exposeInMainWorld('appEvents', {
  /** Subscribes to import progress; returns an unsubscribe function. */
  onImportProgress(listener: (p: ImportProgress) => void): () => void {
    const handler = (_e: unknown, p: ImportProgress): void => listener(p)
    ipcRenderer.on(IMPORT_PROGRESS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(IMPORT_PROGRESS_CHANNEL, handler)
  }
})
