import type { DotaHero, DotaMatch, DotaStats, Lang } from '@shared/types'
import { gameModeName, heroImage, isWin, toAccountId } from '@shared/dota'
import { getJson } from './http'

// OpenDota: an open API over Valve's match data — the same source Dotabuff builds on, no key needed.
const API = 'https://api.opendota.com/api'
const TTL_MS = 10 * 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any

const mean = (xs: number[]): number => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0)

/** Dota 2 profile, rank, recent matches and heroes for the Steam accounts on this PC. */
export class DotaService {
  private readonly cache = new Map<string, { at: number; value: unknown }>()

  constructor(
    private readonly steamIds: () => string[],
    private readonly language: () => Lang
  ) {}

  private async get<T>(path: string): Promise<T> {
    const hit = this.cache.get(path)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T
    const value = (await getJson(`${API}${path}`)) as T
    this.cache.set(path, { at: Date.now(), value })
    return value
  }

  async stats(preferred: string | null): Promise<DotaStats | null> {
    const ids = [...new Set(this.steamIds().map(toAccountId).filter(Boolean))]
    if (!ids.length) return null
    const accounts = await Promise.all(
      ids.map(async (accountId) => {
        const [profile, wl] = await Promise.all([this.get<Raw>(`/players/${accountId}`), this.get<Raw>(`/players/${accountId}/wl`)])
        return {
          accountId,
          name: String(profile?.profile?.personaname ?? accountId),
          avatar: (profile?.profile?.avatarfull as string | undefined) ?? null,
          matches: Number(wl?.win ?? 0) + Number(wl?.lose ?? 0),
          profile,
          wl
        }
      })
    )
    const played = accounts.filter((a) => a.matches > 0).sort((a, b) => b.matches - a.matches)
    if (!played.length) return null
    const me = played.find((a) => a.accountId === preferred) ?? played[0]
    const [recentRaw, heroesRaw, heroList] = await Promise.all([
      this.get<Raw[]>(`/players/${me.accountId}/recentMatches`),
      this.get<Raw[]>(`/players/${me.accountId}/heroes`),
      this.get<Raw[]>('/heroes')
    ])
    const heroById = new Map((heroList ?? []).map((h: Raw) => [Number(h.id), { name: String(h.localized_name), npc: String(h.name) }]))
    const hero = (id: number): { name: string; image: string | null } => {
      const h = heroById.get(Number(id))
      return h ? { name: h.name, image: heroImage(h.npc) } : { name: `#${id}`, image: null }
    }
    const lang = this.language()
    const recent: DotaMatch[] = (recentRaw ?? []).slice(0, 20).map((m: Raw) => ({
      matchId: String(m.match_id),
      heroId: Number(m.hero_id),
      hero: hero(m.hero_id).name,
      heroImage: hero(m.hero_id).image,
      win: isWin(Number(m.player_slot), Boolean(m.radiant_win)),
      kills: Number(m.kills ?? 0),
      deaths: Number(m.deaths ?? 0),
      assists: Number(m.assists ?? 0),
      durationSec: Number(m.duration ?? 0),
      startTime: Number(m.start_time ?? 0) * 1000,
      mode: gameModeName(Number(m.game_mode), lang),
      ranked: Number(m.lobby_type) === 7,
      gpm: Number(m.gold_per_min ?? 0),
      xpm: Number(m.xp_per_min ?? 0),
      lastHits: Number(m.last_hits ?? 0)
    }))
    const heroes: DotaHero[] = (heroesRaw ?? [])
      .filter((h: Raw) => Number(h.games) > 0)
      .slice(0, 12)
      .map((h: Raw) => ({
        heroId: Number(h.hero_id),
        hero: hero(h.hero_id).name,
        heroImage: hero(h.hero_id).image,
        games: Number(h.games),
        wins: Number(h.win),
        lastPlayed: h.last_played ? Number(h.last_played) * 1000 : null
      }))
    return {
      accounts: played.map(({ accountId, name, avatar, matches }) => ({ accountId, name, avatar, matches })),
      accountId: me.accountId,
      name: me.name,
      avatar: me.avatar,
      rankTier: (me.profile?.rank_tier as number | undefined) ?? null,
      leaderboardRank: (me.profile?.leaderboard_rank as number | undefined) ?? null,
      wins: Number(me.wl?.win ?? 0),
      losses: Number(me.wl?.lose ?? 0),
      recent,
      heroes,
      avg: recent.length
        ? {
            kills: mean(recent.map((m) => m.kills)),
            deaths: mean(recent.map((m) => m.deaths)),
            assists: mean(recent.map((m) => m.assists)),
            gpm: Math.round(mean(recent.map((m) => m.gpm))),
            xpm: Math.round(mean(recent.map((m) => m.xpm)))
          }
        : null,
      profileUrl: `https://www.dotabuff.com/players/${me.accountId}`
    }
  }
}
