import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppLink, LibraryImport, LibraryStatus } from '@shared/types'
import { DAY } from '@shared/time'
import type { Connector, Env } from './connections'
import { TtlCache, getJson } from './http'
import { parseVdf, vdfGet, vdfObject, vdfString } from './vdf'

export interface SteamApp {
  appid: string
  name: string
  /** Full install folder */
  installDir: string
}

interface SteamLocal {
  steamPath: string
  apps: SteamApp[]
  account: { steamId64: string; personaName: string; avatar: string | null } | null
  /** appid → minutes played / last played (ms) */
  playtime: Map<string, { minutes: number; lastPlayed: number }>
}

const STEAM_ID_BASE = 76561197960265728n
const NOT_GAMES = /redistributable|runtime|proton|steamvr|soundtrack|dedicated server|\bsdk\b|steamworks|benchmark/i

export const steamHeader = (appid: string): string => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
export const steamStore = (appid: string): string => `https://store.steampowered.com/app/${appid}/`

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

function registrySteamPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout)
      resolve(m ? m[1].trim().replace(/\//g, '\\') : null)
    })
  })
}

/** Reads the local Steam install: libraries, installed games, account and playtime. No API key needed. */
export async function readSteamLocal(): Promise<SteamLocal | null> {
  let steamPath = await registrySteamPath()
  if (!steamPath || !(await exists(steamPath))) steamPath = 'C:\\Program Files (x86)\\Steam'
  if (!(await exists(join(steamPath, 'steamapps')))) return null

  const libraries = new Set<string>([steamPath])
  try {
    const lf = parseVdf(await readFile(join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'))
    for (const entry of Object.values(vdfObject(vdfGet(lf, 'libraryfolders')))) {
      const path = vdfString(vdfGet(entry, 'path'))
      if (path) libraries.add(path)
    }
  } catch {
    // fall back to the main library only
  }

  const apps: SteamApp[] = []
  for (const lib of libraries) {
    const dir = join(lib, 'steamapps')
    let files: string[] = []
    try {
      files = (await readdir(dir)).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const file of files) {
      try {
        const state = vdfGet(parseVdf(await readFile(join(dir, file), 'utf8')), 'AppState')
        const appid = vdfString(vdfGet(state, 'appid'))
        const name = vdfString(vdfGet(state, 'name'))
        const installdir = vdfString(vdfGet(state, 'installdir'))
        if (appid && name && installdir) apps.push({ appid, name, installDir: join(dir, 'common', installdir) })
      } catch {
        // skip broken manifests
      }
    }
  }

  let account: SteamLocal['account'] = null
  const playtime = new Map<string, { minutes: number; lastPlayed: number }>()
  try {
    const users = vdfObject(vdfGet(parseVdf(await readFile(join(steamPath, 'config', 'loginusers.vdf'), 'utf8')), 'users'))
    const ids = Object.keys(users)
    const steamId64 = ids.find((id) => vdfString(vdfGet(users[id], 'MostRecent')) === '1') ?? ids[0]
    if (steamId64) {
      let avatar: string | null = null
      try {
        const png = await readFile(join(steamPath, 'config', 'avatarcache', `${steamId64}.png`))
        avatar = `data:image/png;base64,${png.toString('base64')}`
      } catch {
        // no cached avatar
      }
      account = { steamId64, personaName: vdfString(vdfGet(users[steamId64], 'PersonaName')) ?? 'Steam', avatar }
      const accountId = (BigInt(steamId64) - STEAM_ID_BASE).toString()
      const local = parseVdf(await readFile(join(steamPath, 'userdata', accountId, 'config', 'localconfig.vdf'), 'utf8'))
      const appsNode = vdfObject(vdfGet(local, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps'))
      for (const [appid, node] of Object.entries(appsNode)) {
        const minutes = Number(vdfString(vdfGet(node, 'Playtime')) ?? 0)
        const lastPlayed = Number(vdfString(vdfGet(node, 'LastPlayed')) ?? 0) * 1000
        if (minutes || lastPlayed) playtime.set(appid, { minutes, lastPlayed })
      }
    }
  } catch {
    // account data is optional
  }
  return { steamPath, apps, account, playtime }
}

function libraryStatus(minutes: number, lastPlayed: number): LibraryStatus {
  if (lastPlayed > Date.now() - 14 * DAY) return 'active'
  return minutes > 0 ? 'on_hold' : 'planned'
}

interface OwnedGame {
  appid: number
  name: string
  playtime_forever: number
  rtime_last_played?: number
}

/** Steam: finds installed games and playtime locally; a Web API key adds the whole owned library. */
export class SteamConnector implements Connector {
  readonly key = 'steam' as const
  readonly defaultEnabled = true
  readonly syncEveryMs = 30 * 60_000
  private local: SteamLocal | null = null
  private owned: OwnedGame[] | null = null
  private readonly players = new TtlCache<number | null>(3 * 60_000)

  async sync(env: Env): Promise<void> {
    this.local = await readSteamLocal()
    if (!this.local) {
      env.setState({ connected: false, detail: null, account: null })
      throw new Error(env.language() === 'ru' ? 'Steam не найден на этом компьютере' : 'Steam is not installed on this computer')
    }
    const key = env.secret('apiKey')
    const steamId = env.settings().steamId || this.local.account?.steamId64
    let account = this.local.account?.personaName ?? null
    let avatar = this.local.account?.avatar ?? null
    this.owned = null
    if (key && steamId) {
      const summary = await getJson(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${steamId}`)
      const player = summary?.response?.players?.[0]
      if (player) {
        account = player.personaname ?? account
        avatar = player.avatarfull ?? avatar
      }
      const owned = await getJson(
        `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`
      )
      this.owned = (owned?.response?.games as OwnedGame[] | undefined) ?? []
    }

    // Link tracked apps to their Steam entries by install folder.
    for (const app of env.service.listApps()) {
      const sa = this.appForPath(app.exePath)
      if (sa) env.service.setAppLink(this.linkFor(app.id, sa))
    }
    const appIdBySteam = new Map<string, number>()
    for (const app of env.service.listApps()) {
      const link = env.service.getAppLink(app.id)
      if (link?.provider === 'steam') appIdBySteam.set(link.externalId, app.id)
    }

    const items: LibraryImport[] = []
    if (this.owned) {
      for (const g of this.owned) {
        const appid = String(g.appid)
        if (NOT_GAMES.test(g.name)) continue
        const lastPlayed = (g.rtime_last_played ?? 0) * 1000
        items.push(this.item(appid, g.name, g.playtime_forever, lastPlayed, appIdBySteam.get(appid)))
      }
    } else {
      for (const a of this.local.apps) {
        if (NOT_GAMES.test(a.name)) continue
        const p = this.local.playtime.get(a.appid)
        items.push(this.item(a.appid, a.name, p?.minutes ?? 0, p?.lastPlayed ?? 0, appIdBySteam.get(a.appid)))
      }
    }
    env.service.importLibrary('steam', items, { removeMissing: true })
    const hours = Math.round(items.reduce((s, i) => s + (i.progress ?? 0), 0))
    const ru = env.language() === 'ru'
    env.setState({
      connected: true,
      account,
      avatar,
      detail: ru ? `${items.length} игр · ${hours} ч в Steam` : `${items.length} games · ${hours} h on Steam`
    })
  }

  private item(appid: string, name: string, minutes: number, lastPlayed: number, appId: number | undefined): LibraryImport {
    return {
      kind: 'game',
      externalId: appid,
      title: name,
      coverUrl: steamHeader(appid),
      status: libraryStatus(minutes, lastPlayed),
      progress: Math.round(minutes / 60),
      url: steamStore(appid),
      format: 'Steam',
      appId: appId ?? null
    }
  }

  reset(): void {
    this.owned = null
  }

  appForPath(exePath: string): SteamApp | null {
    if (!exePath || !this.local) return null
    const path = exePath.toLowerCase()
    let best: SteamApp | null = null
    for (const a of this.local.apps) {
      const dir = a.installDir.toLowerCase()
      if (path.startsWith(`${dir}\\`) && (!best || dir.length > best.installDir.length)) best = a
    }
    return best
  }

  linkFor(appId: number, sa: SteamApp): AppLink {
    return { appId, provider: 'steam', externalId: sa.appid, name: sa.name, imageUrl: steamHeader(sa.appid), storeUrl: steamStore(sa.appid) }
  }

  /** Players online right now (public Steam API, no key). */
  playersOnline(appid: string, onFresh: () => void): number | null {
    return (
      this.players.swr(
        appid,
        async () => {
          const r = await getJson(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`)
          return (r?.response?.player_count as number | undefined) ?? null
        },
        onFresh
      ) ?? null
    )
  }

  playtimeMinutes(appid: string): number | null {
    const owned = this.owned?.find((g) => String(g.appid) === appid)
    if (owned) return owned.playtime_forever
    return this.local?.playtime.get(appid)?.minutes ?? null
  }
}
