import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppLink, LibraryImport } from '@shared/types'
import type { Connector, Env } from './connections'

const UNINSTALL_KEYS = [
  String.raw`HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
]

export interface UninstallEntry {
  key: string
  name: string
  installDir: string
  publisher: string
}

export interface BlizzardGame {
  key: string
  name: string
  installDir: string
}

/** Parses `reg query <Uninstall> /s` output into programs with their install folders. */
export function parseUninstall(text: string): UninstallEntry[] {
  const out: UninstallEntry[] = []
  let cur: UninstallEntry | null = null
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      cur = { key: line.split('\\').pop()!.trim(), name: '', installDir: '', publisher: '' }
      out.push(cur)
      continue
    }
    const m = /^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/.exec(line)
    if (!cur || !m) continue
    const value = m[2].trim()
    if (m[1] === 'DisplayName') cur.name = value
    else if (m[1] === 'InstallLocation') cur.installDir = value.replace(/^"|"$/g, '').replace(/[\\/]+$/, '')
    else if (m[1] === 'Publisher') cur.publisher = value
  }
  return out
}

/** Blizzard games (not the Battle.net app itself) that have an install folder. */
export function blizzardGames(entries: UninstallEntry[]): BlizzardGame[] {
  return entries
    .filter((e) => /blizzard/i.test(e.publisher) && e.name && e.installDir && !/battle\.net/i.test(e.name))
    .map((e) => ({ key: e.key, name: e.name, installDir: e.installDir }))
}

function regQuery(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

/** Battle.net: finds installed Blizzard games, links them to the tracker and adds them to the library. */
export class BattleNetConnector implements Connector {
  readonly key = 'battlenet' as const
  readonly defaultEnabled = true
  readonly syncEveryMs = 60 * 60_000
  private games: BlizzardGame[] = []
  private launcherExe: string | null = null

  async sync(env: Env): Promise<void> {
    if (process.platform !== 'win32') return
    const entries = parseUninstall((await Promise.all(UNINSTALL_KEYS.map(regQuery))).join('\n'))
    const app = entries.find((e) => /^battle\.net$/i.test(e.name))
    const launcher = Boolean(app)
    const exe = app?.installDir ? join(app.installDir, 'Battle.net.exe') : null
    this.launcherExe = exe && existsSync(exe) ? exe : null
    this.games = blizzardGames(entries)

    const apps = env.service.listApps()
    for (const app of apps) {
      const g = this.gameForPath(app.exePath)
      if (g && !env.service.getAppLink(app.id)) env.service.setAppLink(this.linkFor(app.id, g))
    }
    const library = env.service.listLibrary({ kind: 'game' })
    const items: LibraryImport[] = []
    for (const g of this.games) {
      const app = apps.find((a) => a.isGame && this.gameForPath(a.exePath) === g)
      // Already on the shelf through the tracker — don't add it twice.
      if (app && library.some((i) => i.appId === app.id && i.source !== 'battlenet')) continue
      const existing = library.find((i) => i.source === 'battlenet' && i.externalId === g.key)
      items.push({
        kind: 'game', externalId: g.key, title: g.name, status: existing?.status ?? 'planned', format: 'Battle.net', appId: app?.id ?? null
      })
    }
    env.service.importLibrary('battlenet', items, { removeMissing: true })
    const ru = env.language() === 'ru'
    const n = this.games.length
    env.setState({
      connected: launcher || n > 0,
      detail: n ? (ru ? `Игр установлено: ${n} · ${this.games.map((g) => g.name).join(', ')}` : `${n} installed · ${this.games.map((g) => g.name).join(', ')}`) : null
    })
  }

  installed(): BlizzardGame[] {
    return this.games
  }

  launcherPath(): string | null {
    return this.launcherExe
  }

  gameForPath(exePath: string): BlizzardGame | null {
    const path = exePath.toLowerCase()
    return this.games.find((g) => path.startsWith(`${g.installDir.toLowerCase()}\\`)) ?? null
  }

  linkFor(appId: number, g: BlizzardGame): AppLink {
    return { appId, provider: 'battlenet', externalId: g.key, name: g.name, imageUrl: null, storeUrl: null }
  }
}
