import { BrowserWindow, app, dialog, ipcMain, nativeTheme, powerMonitor, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HOST_METHODS, IPC_CHANGED, IPC_INVOKE, SERVICE_METHODS, type HostHandlers } from '@shared/api'
import { Service } from '@shared/service'
import { todayKey } from '@shared/time'
import type { ChangeTopic, Lang } from '@shared/types'
import { openNodeDb } from './db'
import { Tracker } from './tracker/tracker'
import { createTray } from './tray'
import appIcon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/tray.png?asset'
import trayPausedIcon from '../../resources/tray-paused.png?asset'

const TITLEBAR_HEIGHT = 48

let win: BrowserWindow | null = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(main)
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

async function main(): Promise<void> {
  app.setAppUserModelId('io.github.mistereshka.timehub')
  const dataPath = app.getPath('userData')
  const db = openNodeDb(join(dataPath, 'timehub.db'))
  const language: Lang = app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en'

  let onSettingsChanged = (): void => {}
  let refreshTray = (): void => {}
  const broadcast = createBroadcaster((topic) => {
    if (topic === 'settings') onSettingsChanged()
    if (topic === 'settings' || topic === 'time' || topic === 'tracker') refreshTray()
  })

  const service = new Service(db, { language, onChange: broadcast })
  const tracker = new Tracker(service, () => broadcast('tracker'))

  service.generateRecurring()
  scheduleMidnight(() => service.generateRecurring())
  powerMonitor.on('resume', () => service.generateRecurring())

  const host: HostHandlers = {
    getMeta: () => ({ version: app.getVersion(), dataPath, demo: false, platform: process.platform, packaged: app.isPackaged }),
    getTrackerStatus: () => tracker.getStatus(),
    exportData: async (format) => {
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        defaultPath: `timehub-${todayKey()}.${format}`,
        filters: [format === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'CSV', extensions: ['csv'] }]
      })
      if (canceled || !filePath) return null
      await writeFile(filePath, format === 'json' ? service.exportJson() : service.exportCsv(), 'utf8')
      return filePath
    },
    openDataFolder: () => void shell.openPath(dataPath),
    setTitleBarTheme: (colors) => win?.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT }),
    openExternal: (url) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
    }
  }
  registerIpc(service, host)

  let lastPollInterval = service.getSettings().pollIntervalSec
  let lastPaused = service.getSettings().trackingPaused
  onSettingsChanged = () => {
    const s = service.getSettings()
    if (s.pollIntervalSec !== lastPollInterval || s.trackingPaused !== lastPaused) {
      lastPollInterval = s.pollIntervalSec
      lastPaused = s.trackingPaused
      tracker.reschedule()
    }
    applyLoginItem(s.autostart)
  }
  applyLoginItem(service.getSettings().autostart)

  win = createWindow(() => service.getSettings().closeToTray)
  const tray = createTray({
    service,
    icon: trayIcon,
    pausedIcon: trayPausedIcon,
    getStatus: () => tracker.getStatus(),
    onOpen: showWindow,
    onQuit: () => app.quit()
  })
  refreshTray = tray.refresh

  app.on('before-quit', () => {
    quitting = true
    tracker.stop()
    db.close()
  })

  await tracker.start()
}

function createWindow(closeToTray: () => boolean): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const w = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'timehub',
    icon: appIcon,
    backgroundColor: dark ? '#0d1117' : '#ffffff',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#010409' : '#f6f8fa', symbolColor: dark ? '#f0f6fc' : '#1f2328', height: TITLEBAR_HEIGHT },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  if (!process.argv.includes('--hidden')) w.once('ready-to-show', () => w.show())
  w.on('close', (e) => {
    if (!quitting && closeToTray()) {
      e.preventDefault()
      w.hide()
    }
  })

  // Links open in the real browser; the app itself never navigates away.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  return w
}

function registerIpc(service: Service, host: HostHandlers): void {
  const serviceMethods = new Set<string>(SERVICE_METHODS)
  const hostMethods = new Set<string>(HOST_METHODS)
  ipcMain.handle(IPC_INVOKE, (_event, method: string, args: unknown[]) => {
    const target: object | null = serviceMethods.has(method) ? service : hostMethods.has(method) ? host : null
    if (!target) throw new Error(`Unknown method: ${method}`)
    const fn = (target as Record<string, (...a: unknown[]) => unknown>)[method]
    return fn.apply(target, args)
  })
}

/** Coalesces change notifications into one IPC message per topic per 150 ms. */
function createBroadcaster(onTopic: (topic: ChangeTopic) => void): (topic: ChangeTopic) => void {
  const pending = new Set<ChangeTopic>()
  let timer: NodeJS.Timeout | null = null
  const flush = (): void => {
    timer = null
    for (const topic of pending) {
      onTopic(topic)
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC_CHANGED, topic)
    }
    pending.clear()
  }
  return (topic) => {
    pending.add(topic)
    timer ??= setTimeout(flush, 150)
  }
}

function scheduleMidnight(job: () => void): void {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
  setTimeout(() => {
    job()
    scheduleMidnight(job)
  }, next.getTime() - now.getTime())
}

function applyLoginItem(enabled: boolean): void {
  // Only the installed app registers itself; dev runs would register electron.exe.
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}
