/// <reference types="vite/client" />
import type { Api } from '@shared/api'
import type { ImportProgress } from '@shared/api/status'

declare global {
  interface Window {
    api: Api
    appEvents: {
      onImportProgress(listener: (p: ImportProgress) => void): () => void
    }
  }
}
