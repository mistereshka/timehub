import { BrowserWindow, app, dialog, ipcMain, nativeTheme, powerMonitor, session, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HOST_METHODS, IPC_CHANGED, IPC_INVOKE, SERVICE_METHODS, type HostHandlers } from '@shared/api'
import { Service } from '@shared/service'
import { todayKey } from '@shared/time'
import type { ChangeTopic, Lang, TrackerStatus } from '@shared/types'
import { openNodeDb } from './db'
import { Tracker } from './tracker/tracker'
import { createTray } from './tray'
import { Connections } from './integrations/connections'
import { SteamConnector } from './integrations/steam'
import { RobloxConnector } from './integrations/roblox'
import { MediaConnector } from './integrations/media'
import { SpotifyConnector } from './integrations/spotify'
import { GitHubConnector } from './integrations/github'
import { CalendarConnector } from './integrations/calendar'
import { DiscordConnector } from './integrations/discord'
import { EpicConnector } from './integrations/epic'
import { AniLibConnector } from './integrations/anilib'
import { ShikimoriConnector } from './integrations/shikimori'
import { TmdbConnector, searchLibrary } from './integrations/search'
import { BattleNetConnector } from './integrations/battlenet'
import { NewDeafConnector, newDeafBase } from './integrations/newdeaf'
import { DotaService } from './integrations/dota'
import { PresenceService } from './integrations/presence'
import { Reminders } from './reminders'
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

/** Runs a periodic job, logging instead of crashing on errors. */
function every(ms: number, job: () => void, runNow = false): void {
  const safe = (): void => {
    try {
      job()
    } catch (err) {
      console.error(err)
    }
  }
  if (runNow) safe()
  setInterval(safe, ms)
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
  // Looking at your own stats isn't activity: timehub never tracks itself.
  service.forgetApps({ paths: [process.execPath], names: ['timehub.exe'] })
  // Once: past browser time on known sites (YouTube…) moves from "Chrome" to those sites.
  service.splitBrowserSessionsBySite()
  const tracker = new Tracker(service, () => broadcast('tracker'))

  // Connections (Steam, Roblox, music, Spotify, GitHub, calendars, Discord, AniLib…)
  const connections = new Connections(service, broadcast)
  const media = new MediaConnector()
  connections.register(
    new SteamConnector(),
    new RobloxConnector(),
    media,
    new SpotifyConnector(),
    new GitHubConnector(),
    new CalendarConnector(),
    new DiscordConnector(() => ({ timer: service.getRunningTimer(), tracker: tracker.getStatus() })),
    new EpicConnector(),
    new AniLibConnector(),
    new ShikimoriConnector(),
    new TmdbConnector(),
    new BattleNetConnector(),
    new NewDeafConnector()
  )
  const presence = new PresenceService(service, connections, () => broadcast('tracker'))
  const dota = new DotaService(
    () => connections.get<SteamConnector>('steam').steamIds(),
    () => service.getSettings().language
  )
  const trackerStatus = (): TrackerStatus => {
    const s = tracker.getStatus()
    return {
      ...s,
      games: presence.decorate(s.games, tracker.getRunningGames()),
      media: connections.isEnabled('media') ? media.presence : null
    }
  }

  service.generateRecurring()
  scheduleMidnight(() => service.generateRecurring())
  powerMonitor.on('resume', () => service.generateRecurring())
  // Recurring tasks that complete on target time, e.g. "English, 2 hours".
  every(30_000, () => service.checkTargets())
  every(5 * 60_000, () => service.refreshGamesInLibrary(), true)
  // Windows notifications before timed tasks and events; a click opens the task.
  const reminders = new Reminders(service, appIcon, (path) => {
    showWindow()
    void win?.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#${path}`)}`)
  })
  every(30_000, () => reminders.tick())

  const host: HostHandlers = {
    getMeta: () => ({ version: app.getVersion(), dataPath, demo: false, platform: process.platform, packaged: app.isPackaged }),
    getTrackerStatus: () => trackerStatus(),
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
    },
    listConnections: () => connections.list(),
    updateConnection: (key, patch) => connections.update(key, patch),
    syncConnection: (key) => connections.sync(key),
    connectSpotify: async () => {
      await connections.update('spotify', { enabled: true })
      await connections.get<SpotifyConnector>('spotify').login(connections.env('spotify'))
      return connections.status('spotify')
    },
    disconnectConnection: (key) => connections.disconnect(key),
    getGameInfo: (appId) => presence.gameInfo(appId),
    getSpotifyOverview: () =>
      connections.isEnabled('spotify') ? connections.get<SpotifyConnector>('spotify').overview(connections.env('spotify')) : null,
    searchLibrary: (kind, query) =>
      searchLibrary(kind, query, {
        tmdbKey: connections.env('tmdb').secret('apiKey'),
        newdeafBase: connections.isEnabled('newdeaf') ? newDeafBase(connections.env('newdeaf').settings()) : null,
        language: service.getSettings().language
      }),
    testReminder: () => reminders.test(),
    getDotaStats: (accountId) => dota.stats(accountId)
  }
  registerIpc(service, host)

  // AniLib/MangaLib covers are hotlink-protected: the CDN answers 403 without their Referer.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.cdnlibs.org/*', 'https://*.imglib.info/*'] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Referer: 'https://anilib.me/' } })
  })

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
    connections.stopAll()
    service.closeMedia(Date.now())
    tracker.stop()
    db.close()
  })

  await tracker.start()
  tracker.ensureSiteIcons()
  await connections.startAll()
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
