import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { constants as zlibConstants, gunzipSync } from 'node:zlib'
import { nativeImage, shell, type NativeImage } from 'electron'
import {
  MINECRAFT_PREFIX, UNKNOWN_MINECRAFT, clockLogStart, debugLogStart, instanceAt, instanceForProcess, instanceLabels, isMinecraftLibraryItem,
  minecraftInstanceOf, packInfo, parseInstanceCfg, type GameRun, type MinecraftMatch, type PackInfo
} from '@shared/minecraft'
import type { Service } from '@shared/service'
import type { MinecraftArt, MinecraftInstance, MinecraftOverview } from '@shared/types'

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

/** Your own name and icon for an instance — kept by timehub; Prism's files stay untouched. */
interface Custom {
  name?: string
  icon?: string
}

const ICON_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.bmp': 'image/bmp'
}
const ICON_SIZE = 128

/** Minecraft: Java & Bedrock Edition for PC in the Microsoft Store — the official art comes from its listing. */
const STORE_PRODUCT = '9NXP44L49SHJ'
const STORE_IMAGES = 'https://store-images.s-microsoft.com/image/'
/** The same art, for when the store can't be reached. */
const FALLBACK_ART: MinecraftArt = {
  poster: `${STORE_IMAGES}apps.808.14492077886571533.be42f4bd-887b-4430-8ed0-622341b4d2b0.c8274c53-105e-478b-9f4b-41b8088210a3`,
  banner: `${STORE_IMAGES}apps.58378.14492077886571533.338a563a-86e7-47b1-b9dc-41cf411f5dcd.dc840f22-6e8f-4a59-b7bc-57958a0740fd`,
  logo: `${STORE_IMAGES}apps.2726.14492077886571533.be42f4bd-887b-4430-8ed0-622341b4d2b0.b7314828-2896-431a-b863-1e3de670a5b2`
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

/** A picture as a small PNG data: URL. */
function iconFromImage(image: NativeImage): string {
  const { width, height } = image.getSize()
  if (Math.max(width, height) <= ICON_SIZE) return image.toDataURL()
  return image.resize(width >= height ? { width: ICON_SIZE, quality: 'best' } : { height: ICON_SIZE, quality: 'best' }).toDataURL()
}

/** Minecraft instances from Prism Launcher: time played in each, runs from their logs, your names and icons, launching. */
export class MinecraftService {
  private cache: { at: number; list: Instance[] } | null = null
  private readonly icons = new Map<string, string | null>()
  private customs: Record<string, Custom>
  private art: MinecraftArt = FALLBACK_ART
  /** Minecraft's own icon, for instances without one */
  private logo: string | null = null

  constructor(
    private readonly service: Service,
    /** exe paths of the games running now ("minecraft:<id>" for instances) */
    private readonly runningGames: () => string[],
    /** where your names and icons are kept */
    private readonly file: string,
    private readonly onChange: () => void
  ) {
    try {
      this.customs = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Custom>
    } catch {
      this.customs = {}
    }
  }

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

  /** The official poster, banner and logo. */
  getArt(): MinecraftArt {
    return this.art
  }

  /** Fetches the official art from the store listing, then dresses the library card and the instance apps. */
  async loadArt(): Promise<void> {
    try {
      const res = await fetch(
        `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${STORE_PRODUCT}&market=US&languages=en-us&MS-CV=DGU1mcuYo0WMMp.0`,
        { signal: AbortSignal.timeout(10_000) }
      )
      type Catalog = { Products?: { LocalizedProperties?: { Images?: { ImagePurpose: string; Uri: string }[] }[] }[] }
      const images = ((await res.json()) as Catalog).Products?.[0]?.LocalizedProperties?.[0]?.Images ?? []
      const pick = (purpose: string, fallback: string): string => {
        const uri = images.find((i) => i.ImagePurpose === purpose)?.Uri
        return uri ? (uri.startsWith('//') ? `https:${uri}` : uri) : fallback
      }
      this.art = { poster: pick('Poster', FALLBACK_ART.poster), banner: pick('SuperHeroArt', FALLBACK_ART.banner), logo: pick('Logo', FALLBACK_ART.logo) }
    } catch {
      // the fallback art stays
    }
    try {
      const res = await fetch(this.art.logo, { signal: AbortSignal.timeout(10_000) })
      const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
      if (res.ok && !image.isEmpty()) this.logo = iconFromImage(image)
    } catch {
      // instances without an icon get minecraft.net's favicon from the tracker
    }
    this.ensureLibraryCover()
    this.syncApps()
  }

  /** The library's Minecraft card wears the official poster. */
  ensureLibraryCover(): void {
    const card = this.service.listLibrary({ kind: 'game' }).find(isMinecraftLibraryItem)
    if (card && !card.coverUrl) this.service.setLibraryCover(card.id, this.art.poster)
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
  private prismIcon(key: string): string | null {
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

  private custom(id: string): Custom {
    return this.customs[id.toLowerCase()] ?? {}
  }

  private setCustom(id: string, patch: Custom): void {
    const next: Custom = { ...this.custom(id), ...patch }
    if (!next.name) delete next.name
    if (!next.icon) delete next.icon
    if (next.name || next.icon) this.customs[id.toLowerCase()] = next
    else delete this.customs[id.toLowerCase()]
    writeFileSync(this.file, JSON.stringify(this.customs, null, 2))
    this.syncApps()
    this.onChange()
  }

  /** What an instance is called and wears everywhere in timehub. */
  private appearance(i: Instance, labels: Map<string, string>): { label: string; appName: string; icon: string | null } {
    const c = this.custom(i.id)
    const auto = labels.get(i.id) ?? i.name
    return { label: c.name ?? auto, appName: c.name ?? `Minecraft ${auto}`, icon: c.icon ?? this.prismIcon(i.iconKey) ?? this.logo }
  }

  /** The apps made for instances follow the instances' names and icons (rename them here, not in Activity). */
  syncApps(): void {
    const all = this.instances()
    const labels = instanceLabels(all)
    for (const app of this.service.listApps()) {
      const id = minecraftInstanceOf(app.exePath)
      if (id == null) continue
      const instance = all.find((x) => x.id.toLowerCase() === id.toLowerCase())
      const look = instance ? this.appearance(instance, labels) : null
      const name = look?.appName ?? (id ? app.displayName : 'Minecraft')
      if (app.displayName !== name) this.service.updateApp(app.id, { displayName: name })
      const icon = look ? look.icon : this.logo
      if (icon && app.icon !== icon) this.service.setAppIcon(app.id, icon)
    }
  }

  private match(i: Instance | undefined, all: Instance[]): MinecraftMatch {
    if (!i) return { ...UNKNOWN_MINECRAFT, icon: this.logo }
    const look = this.appearance(i, instanceLabels(all))
    return { exePath: MINECRAFT_PREFIX + i.id, name: look.appName, icon: look.icon }
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
    this.syncApps()
    const all = this.instances()
    const labels = instanceLabels(all)
    const totals = this.service.appPlayTotals()
    const apps = new Map<string, { id: number; icon: string | null }>()
    for (const a of this.service.listApps()) {
      const id = minecraftInstanceOf(a.exePath)
      if (id != null) apps.set(id.toLowerCase(), a)
    }
    const running = new Set(this.runningGames().map((p) => minecraftInstanceOf(p)?.toLowerCase()))
    const instances: MinecraftInstance[] = all.map((i) => {
      const app = apps.get(i.id.toLowerCase())
      const t = app ? totals.get(app.id) : undefined
      const custom = this.custom(i.id)
      const look = this.appearance(i, labels)
      return {
        id: i.id,
        name: i.name,
        label: look.label,
        autoLabel: labels.get(i.id) ?? i.name,
        customName: !!custom.name,
        customIcon: !!custom.icon,
        mcVersion: i.mcVersion,
        loader: i.loader,
        loaderVersion: i.loaderVersion,
        modCount: this.modCount(i),
        icon: look.icon,
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
      art: this.art,
      instances,
      other: other && otherTotals?.ms ? { appId: other.id, trackedMs: otherTotals.ms, lastPlayed: otherTotals.last || null } : null
    }
  }

  private find(id: string): Instance {
    const instance = this.instances().find((i) => i.id === id)
    if (!instance) throw new Error('Instance not found')
    return instance
  }

  /** Your own name for an instance; empty brings back the automatic one. */
  rename(id: string, name: string | null): void {
    this.setCustom(this.find(id).id, { name: name?.trim().slice(0, 80) || undefined })
  }

  /** Makes a picture from disk the instance's icon (shrunk to a small PNG where possible). */
  setIconFromFile(id: string, path: string): void {
    const instance = this.find(id)
    const image = nativeImage.createFromPath(path)
    let icon: string
    if (!image.isEmpty()) icon = iconFromImage(image)
    else {
      const type = ICON_TYPES[extname(path).toLowerCase()]
      const buf = readFileSync(path)
      if (!type || buf.length > 400_000) throw new Error('This picture can’t be used as an icon')
      icon = `data:${type};base64,${buf.toString('base64')}`
    }
    this.setCustom(instance.id, { icon })
  }

  clearIcon(id: string): void {
    this.setCustom(this.find(id).id, { icon: undefined })
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
