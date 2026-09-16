import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { constants as zlibConstants, gunzipSync } from 'node:zlib'
import { shell } from 'electron'
import {
  MINECRAFT_PREFIX, UNKNOWN_MINECRAFT, clockLogStart, debugLogStart, instanceAt, instanceForProcess, instanceLabels, minecraftInstanceOf,
  packInfo, parseInstanceCfg, type GameRun, type MinecraftMatch, type PackInfo
} from '@shared/minecraft'
import type { Service } from '@shared/service'
import type { AppInfo, MinecraftInstance, MinecraftOverview } from '@shared/types'

interface Instance extends PackInfo {
  id: string
  dir: string
  /** The instance's .minecraft (Prism calls it "minecraft") */
  gameDir: string | null
  name: string
  iconKey: string
  lastLaunch: number | null
  prismMs: number
}

const ICON_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
}

/** The first line of a log, gzipped or not — only the beginning of the file is read. */
function firstLine(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(16_384)
    let data = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0))
    // a cut-off gzip stream still gives what it has with a sync flush
    if (path.toLowerCase().endsWith('.gz')) data = gunzipSync(data, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
    return data.toString('utf8', 0, Math.min(data.length, 512)).split(/\r?\n/)[0]
  } finally {
    closeSync(fd)
  }
}

/** Minecraft instances from Prism Launcher: time played in each, runs from their logs, and launching them. */
export class MinecraftService {
  private cache: { at: number; list: Instance[] } | null = null
  private readonly icons = new Map<string, string | null>()

  constructor(
    private readonly service: Service,
    /** exe paths of the games running now ("minecraft:<id>" for instances) */
    private readonly runningGames: () => string[]
  ) {}

  /** Prism's data folder, or null when Prism isn't installed. */
  dataDir(): string | null {
    const dir = join(process.env.APPDATA ?? '', 'PrismLauncher')
    return existsSync(join(dir, 'prismlauncher.cfg')) || existsSync(join(dir, 'instances')) ? dir : null
  }

  launcherPath(): string | null {
    const data = this.dataDir()
    const candidates = [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'PrismLauncher', 'prismlauncher.exe'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PrismLauncher', 'prismlauncher.exe'),
      // portable install: the data sits next to the launcher
      ...(data ? [join(data, 'prismlauncher.exe')] : [])
    ]
    return candidates.find((p) => existsSync(p)) ?? null
  }

  /** A folder from prismlauncher.cfg (relative to the data folder unless absolute). */
  private folder(key: string, fallback: string): string | null {
    const data = this.dataDir()
    if (!data) return null
    let value = fallback
    try {
      value = parseInstanceCfg(readFileSync(join(data, 'prismlauncher.cfg'), 'utf8'))[key] || fallback
    } catch {
      // defaults
    }
    return isAbsolute(value) ? value : join(data, value)
  }

  private instances(): Instance[] {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.list
    const root = this.folder('InstanceDir', 'instances')
    const list: Instance[] = []
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = root ? readdirSync(root, { withFileTypes: true }) : []
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(root!, entry.name)
      let cfg: Record<string, string>
      try {
        cfg = parseInstanceCfg(readFileSync(join(dir, 'instance.cfg'), 'utf8'))
      } catch {
        continue // not an instance
      }
      let pack: unknown = null
      try {
        pack = JSON.parse(readFileSync(join(dir, 'mmc-pack.json'), 'utf8'))
      } catch {
        // no components listed
      }
      const num = (key: string): number => Number(cfg[key]) || 0
      list.push({
        id: entry.name,
        dir,
        gameDir: ['.minecraft', 'minecraft'].map((d) => join(dir, d)).find((d) => existsSync(d)) ?? null,
        name: cfg.name || entry.name,
        iconKey: cfg.iconKey ?? '',
        lastLaunch: num('lastLaunchTime') || null,
        prismMs: num('totalTimePlayed') * 1000,
        ...packInfo(pack)
      })
    }
    this.cache = { at: Date.now(), list }
    return list
  }

  /** A custom icon from Prism's icons folder (built-in ones like "default" have no file). */
  private icon(key: string): string | null {
    if (!key) return null
    const cached = this.icons.get(key)
    if (cached !== undefined) return cached
    let data: string | null = null
    const dir = this.folder('IconsDir', 'icons')
    try {
      const file = dir ? readdirSync(dir).find((f) => f.slice(0, f.length - extname(f).length) === key && ICON_TYPES[extname(f).toLowerCase()]) : null
      if (dir && file) {
        const buf = readFileSync(join(dir, file))
        if (buf.length < 400_000) data = `data:${ICON_TYPES[extname(file).toLowerCase()]};base64,${buf.toString('base64')}`
      }
    } catch {
      data = null
    }
    this.icons.set(key, data)
    return data
  }

  private modCount(i: Instance): number {
    if (!i.gameDir) return 0
    try {
      return readdirSync(join(i.gameDir, 'mods')).filter((f) => f.toLowerCase().endsWith('.jar')).length
    } catch {
      return 0
    }
  }

  /** Past runs from the logs Minecraft keeps: the first line has the start, the file time is the end. */
  private runs(i: Instance): GameRun[] {
    if (!i.gameDir) return []
    const logs = join(i.gameDir, 'logs')
    let files: string[]
    try {
      files = readdirSync(logs)
    } catch {
      return []
    }
    const hasDebug = files.includes('debug.log')
    const runs: GameRun[] = []
    for (const f of files) {
      const debug = /^debug(-\d+)?\.log(\.gz)?$/i.test(f)
      const dated = /^\d{4}-\d{2}-\d{2}-\d+\.log\.gz$/i.test(f) || (f === 'latest.log' && !hasDebug)
      if (!debug && !dated) continue
      try {
        const path = join(logs, f)
        const end = statSync(path).mtimeMs
        const line = firstLine(path)
        const start = debug ? debugLogStart(line) : clockLogStart(line, end)
        if (start != null && end >= start) runs.push({ start, end })
      } catch {
        // an unreadable log
      }
    }
    return runs
  }

  private match(i: Instance | undefined, all: Instance[]): MinecraftMatch {
    if (!i) return UNKNOWN_MINECRAFT
    return { exePath: MINECRAFT_PREFIX + i.id, name: `Minecraft ${instanceLabels(all).get(i.id)}`, icon: this.icon(i.iconKey) }
  }

  /** The instance of a running game process, from when the process started. */
  forProcess(startedAt: number | null): MinecraftMatch {
    const all = this.instances()
    const id =
      startedAt != null
        ? instanceForProcess(all, startedAt)
        : ([...all].sort((a, b) => (b.lastLaunch ?? 0) - (a.lastLaunch ?? 0))[0]?.id ?? null)
    return this.match(
      all.find((i) => i.id === id),
      all
    )
  }

  /** For history: the instance whose logged run covers a moment, else plain Minecraft. */
  resolverAt(): (at: number) => MinecraftMatch {
    const all = this.instances()
    const withRuns = all.map((i) => ({ id: i.id, runs: this.runs(i) }))
    return (at) =>
      this.match(
        all.find((i) => i.id === instanceAt(withRuns, at)),
        all
      )
  }

  overview(): MinecraftOverview {
    const all = this.instances()
    const labels = instanceLabels(all)
    const totals = this.service.appPlayTotals()
    const apps = new Map<string, AppInfo>()
    for (const a of this.service.listApps()) {
      const id = minecraftInstanceOf(a.exePath)
      if (id != null) apps.set(id.toLowerCase(), a)
    }
    const running = new Set(this.runningGames().map((p) => minecraftInstanceOf(p)?.toLowerCase()))
    const instances: MinecraftInstance[] = all.map((i) => {
      const app = apps.get(i.id.toLowerCase())
      const t = app ? totals.get(app.id) : undefined
      return {
        id: i.id,
        name: i.name,
        label: labels.get(i.id) ?? i.name,
        mcVersion: i.mcVersion,
        loader: i.loader,
        loaderVersion: i.loaderVersion,
        modCount: this.modCount(i),
        icon: this.icon(i.iconKey) ?? null,
        prismMs: i.prismMs,
        lastLaunch: i.lastLaunch,
        appId: app?.id ?? null,
        trackedMs: t?.ms ?? 0,
        lastPlayed: t?.last || null,
        running: running.has(i.id.toLowerCase())
      }
    })
    const last = (i: MinecraftInstance): number => Math.max(i.lastLaunch ?? 0, i.lastPlayed ?? 0)
    instances.sort((a, b) => last(b) - last(a) || a.label.localeCompare(b.label))
    const other = apps.get('')
    const otherTotals = other ? totals.get(other.id) : undefined
    return {
      found: this.dataDir() != null,
      canLaunch: this.launcherPath() != null,
      instances,
      other: other && otherTotals?.ms ? { appId: other.id, trackedMs: otherTotals.ms, lastPlayed: otherTotals.last || null } : null
    }
  }

  private find(id: string): Instance {
    const instance = this.instances().find((i) => i.id === id)
    if (!instance) throw new Error('Instance not found')
    return instance
  }

  /** Starts an instance the way Prism's own "Launch" does (a running Prism takes the request over). */
  launch(id: string): void {
    const instance = this.find(id)
    const exe = this.launcherPath()
    if (!exe) throw new Error('Prism Launcher not found')
    const child = spawn(exe, ['--launch', instance.id], { cwd: dirname(exe), detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  }

  openFolder(id: string): void {
    const instance = this.find(id)
    void shell.openPath(instance.gameDir ?? instance.dir)
  }
}
