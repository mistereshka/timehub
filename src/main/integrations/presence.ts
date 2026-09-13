import { win32 as winPath } from 'node:path'
import type { Service } from '@shared/service'
import type { AppLink, GameInfo, GamePresence, ID } from '@shared/types'
import type { RunningGame } from '../tracker/tracker'
import type { Connections } from './connections'
import type { EpicConnector } from './epic'
import { TtlCache } from './http'
import type { RobloxConnector } from './roblox'
import type { SteamConnector } from './steam'

/** Turns bare "a game is running" into a Discord-style card: cover, players online, your stats. */
export class PresenceService {
  private readonly totals = new TtlCache<{ totalMs: number; todayMs: number; streak: number }>(30_000)

  constructor(
    private readonly service: Service,
    private readonly connections: Connections,
    private readonly onUpdate: () => void
  ) {}

  decorate(games: GamePresence[], running: RunningGame[]): GamePresence[] {
    return games.map((g) => {
      const exePath = running.find((r) => r.appId === g.appId)?.exePath ?? ''
      const link = this.resolveLink(g.appId, exePath)
      const key = String(g.appId)
      let totals = this.totals.get(key)
      if (!totals) {
        totals = this.service.getAppTotals(g.appId)
        this.totals.set(key, totals)
      }
      const extra = this.live(link)
      return {
        ...g,
        provider: link?.provider ?? null,
        details: extra.details,
        imageUrl: extra.imageUrl ?? link?.imageUrl ?? null,
        storeUrl: extra.storeUrl ?? link?.storeUrl ?? null,
        playersOnline: extra.players,
        platformPlaytimeMin: extra.playtime,
        ...totals
      }
    })
  }

  /** For an app report page: waits briefly for fresh store data. */
  async gameInfo(appId: ID): Promise<GameInfo | null> {
    const app = this.service.listApps().find((a) => a.id === appId)
    if (!app) return null
    const link = this.resolveLink(appId, app.exePath)
    if (!link) return null
    this.live(link)
    await new Promise((r) => setTimeout(r, 800))
    const extra = this.live(link)
    return { link, details: extra.details, playersOnline: extra.players, platformPlaytimeMin: extra.playtime }
  }

  private resolveLink(appId: ID, exePath: string): AppLink | null {
    const existing = this.service.getAppLink(appId)
    if (existing) return existing
    let link: AppLink | null = null
    const steam = this.connections.get<SteamConnector>('steam')
    const sa = this.connections.isEnabled('steam') ? steam.appForPath(exePath) : null
    if (sa) link = steam.linkFor(appId, sa)
    else if (winPath.basename(exePath).toLowerCase() === 'robloxplayerbeta.exe') {
      link = { appId, provider: 'roblox', externalId: 'roblox', name: 'Roblox', imageUrl: null, storeUrl: 'https://www.roblox.com' }
    } else {
      const epic = this.connections.get<EpicConnector>('epic')
      const ea = epic.appForPath(exePath)
      if (ea) link = epic.linkFor(appId, ea)
    }
    if (link) this.service.setAppLink(link)
    return link
  }

  private live(link: AppLink | null): {
    details: string | null
    players: number | null
    playtime: number | null
    imageUrl: string | null
    storeUrl: string | null
  } {
    const none = { details: null, players: null, playtime: null, imageUrl: null, storeUrl: null }
    if (!link) return none
    if (link.provider === 'steam' && this.connections.isEnabled('steam')) {
      const steam = this.connections.get<SteamConnector>('steam')
      return { ...none, players: steam.playersOnline(link.externalId, this.onUpdate), playtime: steam.playtimeMinutes(link.externalId) }
    }
    if (link.provider === 'roblox' && this.connections.isEnabled('roblox')) {
      const exp = this.connections.get<RobloxConnector>('roblox').current(this.onUpdate)
      if (exp) return { ...none, details: exp.name, players: exp.playing, imageUrl: exp.icon, storeUrl: exp.url }
    }
    return none
  }
}
