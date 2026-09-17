import { app, powerMonitor } from 'electron'
import { win32 as winPath } from 'node:path'
import type { ActivitySample, Service } from '@shared/service'
import type { GamePresence, ID, TrackerState, TrackerStatus } from '@shared/types'
import { looksLikeGame } from '@shared/catalog'
import { detectSite, isBrowserExe } from '@shared/sites'
import { MINECRAFT_PREFIX, isMinecraftWindow, minecraftInstanceOf, type MinecraftMatch } from '@shared/minecraft'

type Win32 = typeof import('./win32')

const GAME_SCAN_MS = 60_000

export interface RunningGame {
  appId: ID
  exePath: string
  since: number
}

/**
 * Samples the foreground window every poll interval (like Discord's activity
 * detection) and periodically scans running processes for games.
 */
export class Tracker {
  private win32: Win32 | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private gameTimer: NodeJS.Timeout | null = null
  private locked = false
  private status: TrackerStatus = { supported: false, state: 'off', current: null, games: [], media: null }
  private readonly iconRequested = new Set<ID>()
  private readonly gamesSince = new Map<string, number>()
  private running: RunningGame[] = []
  private processPaths = new Set<string>()

  private readonly minecraftByPid = new Map<number, MinecraftMatch>()

  constructor(
    private readonly service: Service,
    private readonly onStatus: (status: TrackerStatus) => void,
    /** The Minecraft instance a game process runs, from when the process started */
    private readonly resolveMinecraft?: (startedAt: number | null) => MinecraftMatch
  ) {}

  async start(): Promise<void> {
    if (process.platform !== 'win32') return
    try {
      this.win32 = await import('./win32')
    } catch (err) {
      console.error('Activity tracker unavailable:', err)
      return
    }
    this.status = { ...this.status, supported: true }
    powerMonitor.on('lock-screen', () => {
      this.locked = true
      this.stopActivity('locked')
    })
    powerMonitor.on('unlock-screen', () => {
      this.locked = false
      this.tick()
    })
    powerMonitor.on('suspend', () => this.stopActivity('idle'))
    powerMonitor.on('resume', () => this.tick())
    this.reschedule()
    setTimeout(() => this.scanGames(), 3000)
    this.gameTimer = setInterval(() => this.scanGames(), GAME_SCAN_MS)
  }

  /** Applies the current poll interval / pause setting. */
  reschedule(): void {
    if (!this.win32) return
    if (this.pollTimer) clearInterval(this.pollTimer)
    const { pollIntervalSec } = this.service.getSettings()
    this.pollTimer = setInterval(() => this.tick(), Math.max(1, pollIntervalSec) * 1000)
    this.tick()
    this.scanGames()
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.gameTimer) clearInterval(this.gameTimer)
    this.service.closeActivity(Date.now())
  }

  getStatus(): TrackerStatus {
    return this.status
  }

  /** Executables running right now (lower-case paths, refreshed every minute). */
  runningPaths(): Set<string> {
    return this.processPaths
  }

  /** Games that are open right now, with their executables (for store lookups). */
  getRunningGames(): RunningGame[] {
    return this.running
  }

  private setStatus(patch: Partial<TrackerStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  private stopActivity(state: TrackerState): void {
    this.service.closeActivity(Date.now())
    this.setStatus({ state, current: null })
  }

  private tick(): void {
    const w = this.win32
    if (!w || this.locked) return
    const settings = this.service.getSettings()
    if (settings.trackingPaused) {
      if (this.status.state !== 'paused') this.stopActivity('paused')
      return
    }
    try {
      const fg = w.getForegroundWindow()
      if (!fg) return
      // timehub itself is never tracked: looking at your stats isn't activity.
      if (fg.pid === process.pid || (fg.exePath !== '' && fg.exePath.toLowerCase() === process.execPath.toLowerCase())) {
        if (this.status.state !== 'ignored') this.stopActivity('ignored')
        return
      }
      if (fg.exeName.toLowerCase() === 'lockapp.exe') {
        this.stopActivity('locked')
        return
      }
      const displayName = w.fileDescription(fg.exePath) ?? undefined
      let sample: Pick<ActivitySample, 'exePath' | 'exeName' | 'title' | 'displayName' | 'categoryKey'> = {
        exePath: fg.exePath,
        exeName: fg.exeName,
        title: fg.title,
        displayName
      }
      // A tab on a known site (YouTube, Яндекс Музыка, GitHub…) counts as that site, not as "Chrome".
      const site = isBrowserExe(fg.exeName) ? detectSite(fg.title) : null
      if (site) {
        const browser = this.service.ensureApp(fg.exePath, fg.exeName, displayName).app
        if (!browser.ignored) {
          sample = {
            exePath: `site:${site.key}`,
            exeName: site.domain,
            // "don't record titles" on the browser also covers its sites
            title: browser.recordTitles ? site.pageTitle : '',
            displayName: site.name,
            categoryKey: site.category
          }
        }
      }
      // Minecraft runs inside Java: its window counts as the instance played, not as "OpenJDK Platform binary".
      let minecraftIcon: string | null = null
      if (!site && this.resolveMinecraft && isMinecraftWindow(fg.exeName, fg.title)) {
        const java = this.service.ensureApp(fg.exePath, fg.exeName, displayName).app
        if (!java.ignored) {
          const mc = this.minecraftFor(fg.pid)
          minecraftIcon = mc.icon
          sample = {
            exePath: mc.exePath,
            exeName: 'minecraft',
            title: java.recordTitles ? fg.title : '',
            displayName: mc.name,
            categoryKey: 'games'
          }
        }
      }
      const result = this.service.recordSample(
        { at: Date.now(), ...sample, idleMs: powerMonitor.getSystemIdleTime() * 1000 },
        { intervalMs: settings.pollIntervalSec * 1000, idleThresholdMs: settings.idleThresholdMin * 60_000 }
      )
      if (result.state === 'active') {
        const a = result.app
        if (!a.icon) {
          if (a.exePath.startsWith('site:')) this.loadSiteIcon(a.id, a.exeName)
          else if (minecraftInstanceOf(a.exePath) != null) this.loadMinecraftIcon(a.id, minecraftIcon)
          else if (fg.exePath) this.loadIcon(a.id, fg.exePath)
        }
        this.setStatus({
          state: 'active',
          current: { appId: a.id, displayName: a.displayName, icon: a.icon, title: result.title, since: result.since }
        })
      } else {
        this.setStatus({ state: result.state, current: null })
      }
    } catch (err) {
      console.error('Tracker tick failed:', err)
    }
  }

  private scanGames(): void {
    const w = this.win32
    if (!w) return
    if (this.service.getSettings().trackingPaused) {
      this.running = []
      if (this.status.games.length) this.setStatus({ games: [] })
      return
    }
    let processes: { pid: number; path: string }[]
    let titles: Map<number, string>
    try {
      processes = w.listProcesses()
      titles = w.visibleWindowTitles()
      this.processPaths = new Set(processes.map((p) => p.path.toLowerCase()))
    } catch (err) {
      console.error('Process scan failed:', err)
      return
    }
    const flagged = new Map(
      this.service
        .listApps()
        .filter((a) => a.isGame)
        .map((a) => [a.exePath.toLowerCase(), a])
    )
    const now = Date.now()
    const running: RunningGame[] = []
    const games: GamePresence[] = []
    const seen = new Set<string>()
    for (const { pid, path } of processes) {
      // A game counts only while it has a window — not when it idles in the tray.
      const title = titles.get(pid)
      if (title == null) continue
      const exeName = winPath.basename(path)
      let exePath = path
      let info = flagged.get(path.toLowerCase())
      let minecraft: MinecraftMatch | null = null
      if (this.resolveMinecraft && isMinecraftWindow(exeName, title)) {
        minecraft = this.minecraftFor(pid)
        exePath = minecraft.exePath
        info = this.service.ensureApp(exePath, 'minecraft', minecraft.name, 'games').app
      }
      const key = exePath.toLowerCase()
      if (seen.has(key)) continue
      if (!info) {
        if (!looksLikeGame(exeName, path)) continue
        info = this.service.ensureApp(path, exeName, w.fileDescription(path) ?? undefined).app
      }
      if (!info.isGame) continue // the user un-flagged it
      if (info.ignored) continue
      seen.add(key)
      if (!this.gamesSince.has(key)) this.gamesSince.set(key, now)
      const since = this.gamesSince.get(key)!
      running.push({ appId: info.id, exePath, since })
      games.push({
        appId: info.id, displayName: info.displayName, icon: info.icon, since, provider: null, details: null, imageUrl: null,
        playersOnline: null, storeUrl: null, totalMs: 0, todayMs: 0, streak: 0, platformPlaytimeMin: null
      })
      if (!info.icon) {
        if (minecraft) this.loadMinecraftIcon(info.id, minecraft.icon)
        else this.loadIcon(info.id, path)
      }
    }
    for (const key of [...this.gamesSince.keys()]) if (!seen.has(key)) this.gamesSince.delete(key)
    this.running = running
    this.setStatus({ games })
  }

  /** The instance a Minecraft process runs — asked once per process, once it's known. */
  private minecraftFor(pid: number): MinecraftMatch {
    const known = this.minecraftByPid.get(pid)
    if (known) return known
    const match = this.resolveMinecraft!(this.win32?.processStartTime(pid) ?? null)
    if (match.exePath !== MINECRAFT_PREFIX) {
      if (this.minecraftByPid.size > 16) this.minecraftByPid.clear()
      this.minecraftByPid.set(pid, match)
    }
    return match
  }

  /** An instance's own icon, or Minecraft's. */
  private loadMinecraftIcon(appId: ID, icon: string | null): void {
    if (!icon) return this.loadSiteIcon(appId, 'minecraft.net')
    if (this.iconRequested.has(appId)) return
    this.iconRequested.add(appId)
    this.service.setAppIcon(appId, icon)
  }

  /** Favicons for sites split out of the browser history (Minecraft instances get theirs from MinecraftService). */
  ensureSiteIcons(): void {
    for (const a of this.service.listApps()) if (!a.icon && a.exePath.startsWith('site:')) this.loadSiteIcon(a.id, a.exeName)
  }

  private loadSiteIcon(appId: ID, domain: string): void {
    if (this.iconRequested.has(appId)) return
    this.iconRequested.add(appId)
    void (async () => {
      for (const url of [`https://${domain}/favicon.ico`, `https://icons.duckduckgo.com/ip3/${domain}.ico`]) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
          const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
          if (!res.ok || !type.startsWith('image/')) continue
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length < 64 || buf.length > 300_000) continue
          this.service.setAppIcon(appId, `data:${type};base64,${buf.toString('base64')}`)
          return
        } catch {
          // try the next source
        }
      }
    })()
  }

  private loadIcon(appId: ID, exePath: string): void {
    if (this.iconRequested.has(appId)) return
    this.iconRequested.add(appId)
    app
      .getFileIcon(exePath, { size: 'normal' })
      .then((img) => {
        if (!img.isEmpty()) this.service.setAppIcon(appId, img.toDataURL())
      })
      .catch(() => {})
  }
}
