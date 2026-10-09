import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_METHODS, IMPORT_PROGRESS_CHANNEL, type Api, type ApiMethod } from '@shared/api'
import { createApi } from './api'
import { devDbPath, openDatabase } from './db'

// Screenshot mode for development: FD_SHOT='{"route":"/running","out":"shots/running.png"}'
// renders one route off-screen, saves a full-page PNG and quits. See scripts/shot.mjs.
interface ShotRequest {
  route: string
  out: string
  width?: number
  height?: number
  theme?: 'light' | 'dark'
  delay?: number
}
const shot: ShotRequest | null = process.env.FD_SHOT ? JSON.parse(process.env.FD_SHOT) : null

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: shot?.width ?? 1440,
    height: shot?.height ?? 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    // A hidden window never paints (and WebGL maps stay blank), so screenshot mode
    // shows a real window parked far outside the visible desktop.
    ...(shot ? { x: -20000, y: -20000, skipTaskbar: true, focusable: false } : {}),
    title: 'Fitness Dashboard',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#f3f2ee',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    }
  })

  win.once('ready-to-show', () => (shot ? win.showInactive() : win.show()))

  // External links (map attribution, etc.) open in the system browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const hash = shot?.route ?? '/'
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
  return win
}

async function captureAndQuit(win: BrowserWindow, req: ShotRequest): Promise<void> {
  const wc = win.webContents
  try {
    await new Promise((r) => setTimeout(r, req.delay ?? 2500))
    wc.debugger.attach('1.3')
    const metrics = await wc.debugger.sendCommand('Page.getLayoutMetrics')
    const size = metrics.cssContentSize ?? metrics.contentSize
    const res = await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 }
    })
    writeFileSync(req.out, Buffer.from(res.data, 'base64'))
    console.log(`shot saved: ${req.out} (${Math.ceil(size.width)}x${Math.ceil(size.height)})`)
  } catch (err) {
    console.error('shot failed:', err)
    process.exitCode = 1
  } finally {
    app.exit(process.exitCode === 1 ? 1 : 0)
  }
}

app.whenReady().then(() => {
  if (shot?.theme) nativeTheme.themeSource = shot.theme

  const dbPath = process.env.FD_DB ?? (app.isPackaged ? join(app.getPath('userData'), 'fitness.db') : devDbPath())
  const db = openDatabase(dbPath)

  const api = createApi(db, {
    pickExportFile: async () => {
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose your Apple Health export',
        defaultPath: app.getPath('downloads'),
        properties: ['openFile'],
        filters: [{ name: 'Apple Health export', extensions: ['zip'] }]
      }
      const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
      return res.canceled ? undefined : res.filePaths[0]
    },
    onImportProgress: (p) => mainWindow?.webContents.send(IMPORT_PROGRESS_CHANNEL, p)
  })

  ipcMain.handle('api', (_event, method: ApiMethod, args: unknown[]) => {
    if (!API_METHODS.includes(method)) throw new Error(`Unknown API method: ${String(method)}`)
    return (api[method] as (...a: unknown[]) => ReturnType<Api[ApiMethod]>)(...args)
  })

  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  if (shot) {
    const win = mainWindow
    // Surface renderer warnings and errors in the terminal that ran the screenshot.
    win.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') console.log(`[renderer ${e.level}] ${e.message}`)
    })
    win.webContents.once('did-finish-load', () => void captureAndQuit(win, shot))
  }

  app.on('window-all-closed', () => {
    db.close()
    app.quit()
  })
})
