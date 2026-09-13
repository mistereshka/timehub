import { app, powerMonitor } from 'electron'
import { win32 as winPath } from 'node:path'
import type { Service } from '@shared/service'
import type { GamePresence, ID, TrackerState, TrackerStatus } from '@shared/types'
import { looksLikeGame } from '@shared/catalog'

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

  constructor(
    private readonly service: Service,
    private readonly onStatus: (status: TrackerStatus) => void
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
      const result = this.service.recordSample(
        {
          at: Date.now(),
          exePath: fg.exePath,
          exeName: fg.exeName,
          title: fg.title,
          idleMs: powerMonitor.getSystemIdleTime() * 1000,
          displayName: w.fileDescription(fg.exePath) ?? undefined
        },
        { intervalMs: settings.pollIntervalSec * 1000, idleThresholdMs: settings.idleThresholdMin * 60_000 }
      )
      if (result.state === 'active') {
        const a = result.app
        if (!a.icon && fg.exePath) this.loadIcon(a.id, fg.exePath)
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
    let visible: Set<number>
    try {
      processes = w.listProcesses()
      visible = w.visibleWindowPids()
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
      const key = path.toLowerCase()
      // A game counts only while it has a window — not when it idles in the tray.
      if (seen.has(key) || !visible.has(pid)) continue
      let info = flagged.get(key)
      if (!info) {
        const exeName = winPath.basename(path)
        if (!looksLikeGame(exeName, path)) continue
        info = this.service.ensureApp(path, exeName, w.fileDescription(path) ?? undefined).app
        if (!info.isGame) continue // the user un-flagged it
      }
      if (info.ignored) continue
      seen.add(key)
      if (!this.gamesSince.has(key)) this.gamesSince.set(key, now)
      const since = this.gamesSince.get(key)!
      running.push({ appId: info.id, exePath: path, since })
      games.push({
        appId: info.id, displayName: info.displayName, icon: info.icon, since, provider: null, details: null, imageUrl: null,
        playersOnline: null, storeUrl: null, totalMs: 0, todayMs: 0, streak: 0, platformPlaytimeMin: null
      })
      if (!info.icon) this.loadIcon(info.id, path)
    }
    for (const key of [...this.gamesSince.keys()]) if (!seen.has(key)) this.gamesSince.delete(key)
    this.running = running
    this.setStatus({ games })
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
