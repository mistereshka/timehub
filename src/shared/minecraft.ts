import { DAY, MINUTE } from './time'

/**
 * Minecraft: Java Edition runs inside Java — the process is java(w).exe (Prism's own runtime, the
 * official launcher's…), only the window title says "Minecraft".
 */
const JAVA_EXES = new Set(['java.exe', 'javaw.exe'])
export const isJavaExe = (exeName: string): boolean => JAVA_EXES.has(exeName.toLowerCase())
export const isMinecraftWindow = (exeName: string, title: string): boolean => isJavaExe(exeName) && /^minecraft\b/i.test(title.trim())

/** Minecraft apps are keyed "minecraft:<instance folder>" — or just "minecraft:" when the instance is unknown. */
export const MINECRAFT_PREFIX = 'minecraft:'
export const minecraftInstanceOf = (exePath: string): string | null =>
  exePath.toLowerCase().startsWith(MINECRAFT_PREFIX) ? exePath.slice(MINECRAFT_PREFIX.length) : null

/** What the tracker records a Minecraft window as. */
export interface MinecraftMatch {
  exePath: string
  name: string
  /** The instance's own icon (data: URL), if it has one */
  icon: string | null
}
export const UNKNOWN_MINECRAFT: MinecraftMatch = { exePath: MINECRAFT_PREFIX, name: 'Minecraft', icon: null }

/** instance.cfg / prismlauncher.cfg: key=value lines; [sections] and comments are skipped. */
export function parseInstanceCfg(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^=[#;][^=]*)=(.*)$/.exec(line)
    if (m) out[m[1].trim()] = m[2].trim().replace(/^"(.*)"$/, '$1')
  }
  return out
}

const LOADERS: [uid: string, name: string][] = [
  ['net.neoforged', 'NeoForge'],
  ['net.minecraftforge', 'Forge'],
  ['net.fabricmc.fabric-loader', 'Fabric'],
  ['org.quiltmc.quilt-loader', 'Quilt'],
  ['com.mumfrey.liteloader', 'LiteLoader']
]

export interface PackInfo {
  mcVersion: string | null
  loader: string | null
  loaderVersion: string | null
}

/** Minecraft version and mod loader from an instance's mmc-pack.json. */
export function packInfo(pack: unknown): PackInfo {
  const raw = (pack as { components?: unknown } | null)?.components
  const components = Array.isArray(raw) ? (raw as { uid?: string; version?: string; cachedVersion?: string }[]) : []
  const version = (uid: string): string | null => {
    const c = components.find((x) => x.uid === uid)
    return c?.version ?? c?.cachedVersion ?? null
  }
  const loader = LOADERS.find(([uid]) => components.some((c) => c.uid === uid))
  return { mcVersion: version('net.minecraft'), loader: loader?.[1] ?? null, loaderVersion: loader ? version(loader[0]) : null }
}

/**
 * "1.20.1 · Forge"; instances that would look the same also get what tells their folders apart —
 * Prism names copies "1.20.1(2)", so that one becomes "1.20.1 · Forge (2)".
 */
export function instanceLabels(list: { id: string; name: string; loader: string | null }[]): Map<string, string> {
  type Item = { id: string; name: string; loader: string | null }
  const base = (i: Item): string => `${i.name || i.id} · ${i.loader ?? 'Vanilla'}`
  const tag = (i: Item): string => {
    if (!i.name || !i.id.startsWith(i.name)) return i.id
    return i.id.slice(i.name.length).replace(/^[\s(_-]+|[\s)]+$/g, '')
  }
  const counts = new Map<string, number>()
  for (const i of list) counts.set(base(i), (counts.get(base(i)) ?? 0) + 1)
  return new Map(
    list.map((i) => {
      if ((counts.get(base(i)) ?? 0) < 2) return [i.id, base(i)]
      const suffix = tag(i)
      return [i.id, suffix ? `${base(i)} (${suffix})` : base(i)]
    })
  )
}

/** One launch of an instance, as its logs tell it. */
export interface GameRun {
  start: number
  end: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "[17Sep2026 02:37:01.063] …" — the first line of a Forge/NeoForge debug.log. */
export function debugLogStart(firstLine: string): number | null {
  const m = /^\[(\d{1,2})([A-Za-z]{3})(\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(firstLine)
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1
  if (!m || month < 0) return null
  return new Date(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])).getTime()
}

/** "[01:47:12] …" — plain Minecraft logs only carry the time; the day comes from when the log was last written. */
export function clockLogStart(firstLine: string, endedAt: number): number | null {
  const m = /^\[(\d{2}):(\d{2}):(\d{2})\]/.exec(firstLine)
  if (!m) return null
  const d = new Date(endedAt)
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0)
  // a run that went past midnight started the day before
  return d.getTime() > endedAt ? d.getTime() - DAY : d.getTime()
}

/** The instance whose run covers that moment — the latest one if runs overlap. */
export function instanceAt(instances: { id: string; runs: GameRun[] }[], at: number): string | null {
  const slack = 2 * MINUTE
  let best: { id: string; start: number } | null = null
  for (const i of instances) {
    for (const r of i.runs) {
      if (at >= r.start - slack && at <= r.end + slack && (!best || r.start > best.start)) best = { id: i.id, start: r.start }
    }
  }
  return best?.id ?? null
}

/**
 * The instance a game process belongs to: Prism notes the launch time a moment before it starts Java,
 * so it's the instance launched last before the process (and not long before — mods can take a while).
 */
export function instanceForProcess(instances: { id: string; lastLaunch: number | null }[], startedAt: number): string | null {
  let best: { id: string; lastLaunch: number } | null = null
  for (const i of instances) {
    if (i.lastLaunch == null || i.lastLaunch > startedAt + MINUTE || startedAt - i.lastLaunch > 30 * MINUTE) continue
    if (!best || i.lastLaunch > best.lastLaunch) best = { id: i.id, lastLaunch: i.lastLaunch }
  }
  return best?.id ?? null
}
