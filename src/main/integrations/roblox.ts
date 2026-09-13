import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Connector, Env } from './connections'
import { TtlCache, getJson } from './http'

export interface RobloxJoin {
  placeId: string
  universeId: string | null
}

/**
 * Finds the experience the Roblox client last joined in its log, and whether
 * it has left since. Formats: "! Joining game '<job>' place <id> at <ip>",
 * "game_join_loadtime: … universeid:<id>", "leaveUGCGameInternal".
 */
export function parseRobloxLog(text: string): { join: RobloxJoin | null; left: boolean } {
  let join: RobloxJoin | null = null
  let left = false
  for (const line of text.split('\n')) {
    const j = /! Joining game '[^']*' place (\d+)/.exec(line)
    if (j) {
      join = { placeId: j[1], universeId: null }
      left = false
      continue
    }
    if (!join) continue
    const u = /universeid:(\d+)/i.exec(line)
    if (u && !join.universeId) join.universeId = u[1]
    if (/leaveUGCGameInternal|Time to disconnect replication data|Disconnection Notification/.test(line)) left = true
  }
  return { join, left }
}

export interface RobloxExperience {
  placeId: string
  universeId: string
  name: string
  playing: number | null
  icon: string | null
  url: string
}

const LOG_DIR = (): string => join(process.env.LOCALAPPDATA ?? '', 'Roblox', 'logs')
const TAIL_BYTES = 4 * 1024 * 1024

async function readTail(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, size - length)
    return buf.toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Roblox: which experience you're in (from the client log) and how many people play it. */
export class RobloxConnector implements Connector {
  readonly key = 'roblox' as const
  readonly defaultEnabled = true
  readonly syncEveryMs = 60 * 60_000
  private readonly universes = new TtlCache<string | null>(24 * 60 * 60_000)
  private readonly games = new TtlCache<RobloxExperience | null>(2 * 60_000)
  private readonly joins = new TtlCache<RobloxJoin | null>(20_000)

  async sync(env: Env): Promise<void> {
    const username = env.settings().username?.trim()
    if (!username) {
      env.setState({ connected: true, account: null, avatar: null, detail: null })
      return
    }
    const found = await getJson('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
    })
    const user = found?.data?.[0]
    if (!user) throw new Error(env.language() === 'ru' ? 'Пользователь Roblox не найден' : 'Roblox user not found')
    const thumb = await getJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png`)
    env.setState({ connected: true, account: user.displayName ?? user.name, avatar: thumb?.data?.[0]?.imageUrl ?? null })
  }

  /** The experience you're in right now, from cache; refreshes in the background. */
  current(onFresh: () => void): RobloxExperience | null {
    const join = this.joins.swr('current', () => this.readJoin(), onFresh)
    if (!join) return null
    return this.games.swr(join.placeId, () => this.fetchExperience(join), onFresh) ?? null
  }

  private async readJoin(): Promise<RobloxJoin | null> {
    const dir = LOG_DIR()
    const files = (await readdir(dir)).filter((f) => f.endsWith('.log'))
    const withTimes = await Promise.all(files.map(async (f) => ({ f, t: (await stat(join(dir, f))).mtimeMs })))
    withTimes.sort((a, b) => b.t - a.t)
    // The game client writes its own log next to the launcher's; check the newest few.
    for (const { f, t } of withTimes.slice(0, 4)) {
      if (Date.now() - t > 12 * 60 * 60_000) break
      const { join: j, left } = parseRobloxLog(await readTail(join(dir, f)))
      if (j) return left ? null : j
    }
    return null
  }

  private async fetchExperience(join: RobloxJoin): Promise<RobloxExperience | null> {
    let universeId = join.universeId ?? this.universes.get(join.placeId) ?? null
    if (!universeId) {
      const r = await getJson(`https://apis.roblox.com/universes/v1/places/${join.placeId}/universe`)
      universeId = r?.universeId ? String(r.universeId) : null
      this.universes.set(join.placeId, universeId)
    }
    if (!universeId) return null
    const [game, icon] = await Promise.all([
      getJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
      getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`)
    ])
    const g = game?.data?.[0]
    if (!g) return null
    return {
      placeId: join.placeId,
      universeId,
      name: g.name,
      playing: typeof g.playing === 'number' ? g.playing : null,
      icon: icon?.data?.[0]?.imageUrl ?? null,
      url: `https://www.roblox.com/games/${join.placeId}`
    }
  }
}
