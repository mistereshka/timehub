import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { shell } from 'electron'
import type { Service } from '@shared/service'
import type { AppInfo, InstalledGame } from '@shared/types'
import type { BattleNetConnector } from './integrations/battlenet'
import type { EpicConnector } from './integrations/epic'
import { steamCapsule, type SteamConnector } from './integrations/steam'

/** Battle.net product codes for `Battle.net.exe --exec="launch <code>"`. */
const BNET_CODES: [RegExp, string][] = [
  [/hearthstone/i, 'WTCG'], [/overwatch/i, 'Pro'], [/world of warcraft/i, 'WoW'], [/diablo iv|diablo 4/i, 'Fen'],
  [/diablo iii|diablo 3/i, 'D3'], [/diablo ii|diablo 2/i, 'OSI'], [/diablo immortal/i, 'ANBS'], [/starcraft ii|starcraft 2/i, 'S2'],
  [/starcraft/i, 'S1'], [/heroes of the storm/i, 'Hero'], [/warcraft iii|warcraft 3/i, 'W3']
]

type Launch = { kind: 'url'; url: string } | { kind: 'exe'; path: string; args: string[] }

/** Everything installed that can be started: Steam, Epic, Battle.net and games the tracker has seen. */
export class GamesService {
  private readonly launches = new Map<string, Launch>()

  constructor(
    private readonly service: Service,
    private readonly steam: () => SteamConnector,
    private readonly epic: () => EpicConnector,
    private readonly bnet: () => BattleNetConnector
  ) {}

  list(): InstalledGame[] {
    const totals = this.service.appPlayTotals()
    const apps = this.service.listApps()
    const links = new Map(apps.map((a) => [a.id, this.service.getAppLink(a.id)]))
    const trackedBy = (provider: string, externalId: string): AppInfo | undefined =>
      apps.find((a) => links.get(a.id)?.provider === provider && links.get(a.id)?.externalId === externalId)
    const stats = (app: AppInfo | undefined, platformLast = 0): Pick<InstalledGame, 'appId' | 'icon' | 'trackedMs' | 'lastPlayed'> => {
      const t = app ? totals.get(app.id) : undefined
      const last = Math.max(t?.last ?? 0, platformLast)
      return { appId: app?.id ?? null, icon: app?.icon ?? null, trackedMs: t?.ms ?? 0, lastPlayed: last || null }
    }
    const out: InstalledGame[] = []
    this.launches.clear()
    const add = (game: InstalledGame, launch: Launch): void => {
      if (this.launches.has(game.id)) return // one entry per game
      out.push(game)
      this.launches.set(game.id, launch)
    }

    const steam = this.steam()
    const epic = this.epic().installed()
    const bnet = this.bnet()
    // A game the tracker saw inside a Steam/Epic/Battle.net folder is already listed under that store.
    const storeDirs = [...steam.installedGames().map((g) => g.installDir), ...epic.map((g) => g.installDir), ...bnet.installed().map((g) => g.installDir)]
      .filter(Boolean)
      .map((d) => `${d.toLowerCase().replace(/[\\/]+$/, '')}\\`)
    const inStoreDir = (exePath: string): boolean => storeDirs.some((d) => exePath.toLowerCase().startsWith(d))

    for (const g of steam.installedGames()) {
      add(
        { id: `steam:${g.appid}`, name: g.name, platform: 'steam', cover: steamCapsule(g.appid), platformMinutes: steam.playtimeMinutes(g.appid), ...stats(trackedBy('steam', g.appid), g.lastPlayed) },
        { kind: 'url', url: `steam://rungameid/${g.appid}` }
      )
    }
    for (const g of epic) {
      add(
        { id: `epic:${g.appName}`, name: g.name, platform: 'epic', cover: null, platformMinutes: null, ...stats(trackedBy('epic', g.appName)) },
        { kind: 'url', url: `com.epicgames.launcher://apps/${encodeURIComponent(g.appName)}?action=launch&silent=true` }
      )
    }
    const launcher = bnet.launcherPath()
    for (const g of bnet.installed()) {
      const app = trackedBy('battlenet', g.key)
      const code = BNET_CODES.find(([re]) => re.test(g.name))?.[1]
      const launch: Launch =
        code && launcher
          ? { kind: 'exe', path: launcher, args: [`--exec=launch ${code}`] }
          : { kind: 'exe', path: app?.exePath ?? launcher ?? '', args: [] }
      add({ id: `battlenet:${g.key}`, name: g.name, platform: 'battlenet', cover: null, platformMinutes: null, ...stats(app) }, launch)
    }
    const covered = new Set(out.map((g) => g.appId).filter((id) => id != null))
    for (const app of apps) {
      if (!app.isGame || app.ignored || covered.has(app.id) || !app.exePath || inStoreDir(app.exePath) || !existsSync(app.exePath)) continue
      add(
        { id: `app:${app.id}`, name: app.displayName, platform: 'other', cover: null, platformMinutes: null, ...stats(app) },
        { kind: 'exe', path: app.exePath, args: [] }
      )
    }
    return out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name))
  }

  async launch(id: string): Promise<void> {
    if (!this.launches.has(id)) this.list()
    const launch = this.launches.get(id)
    if (!launch) throw new Error('Game not found')
    if (launch.kind === 'url') {
      await shell.openExternal(launch.url)
      return
    }
    if (!launch.path) throw new Error('No launcher for this game')
    if (!launch.args.length) {
      const error = await shell.openPath(launch.path)
      if (error) throw new Error(error)
      return
    }
    const child = spawn(launch.path, launch.args, { cwd: dirname(launch.path), detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  }
}
