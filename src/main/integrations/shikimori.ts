import type { LibraryImport, LibraryKind, LibrarySearchResult, LibraryStatus } from '@shared/types'
import type { Connector, Env } from './connections'
import { getJson } from './http'

const HOST = 'https://shikimori.one'

const STATUS: Record<string, LibraryStatus> = {
  planned: 'planned', watching: 'active', rewatching: 'rewatching', completed: 'completed', on_hold: 'on_hold', dropped: 'dropped'
}

const abs = (path: string | undefined): string | null => (path ? (path.startsWith('http') ? path : `${HOST}${path}`) : null)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRate(rate: any, kind: LibraryKind): LibraryImport | null {
  const t = kind === 'anime' ? rate.anime : rate.manga
  if (!t?.id) return null
  const total = kind === 'anime' ? t.episodes || null : t.chapters || null
  return {
    kind,
    externalId: `${kind}:${t.id}`,
    title: t.russian || t.name,
    originalTitle: t.name ?? '',
    coverUrl: abs(t.image?.original),
    status: STATUS[rate.status] ?? 'planned',
    progress: kind === 'anime' ? rate.episodes ?? 0 : rate.chapters ?? 0,
    total,
    latest: kind === 'anime' ? t.episodes_aired || null : null,
    rating: rate.score || null,
    year: Number(String(t.aired_on ?? '').slice(0, 4)) || null,
    format: t.kind ?? '',
    url: abs(t.url)
  }
}

/** Shikimori: another place to import anime and manga lists from (public API). */
export class ShikimoriConnector implements Connector {
  readonly key = 'shikimori' as const
  readonly defaultEnabled = false
  readonly syncEveryMs = 60 * 60_000

  async sync(env: Env): Promise<void> {
    const ru = env.language() === 'ru'
    const nick = env.settings().nickname?.trim()
    if (!nick) throw new Error(ru ? 'Укажите никнейм Shikimori' : 'Enter your Shikimori nickname')
    const user = await getJson(`${HOST}/api/users/${encodeURIComponent(nick)}?is_nickname=1`)
    const [anime, manga] = await Promise.all([
      getJson(`${HOST}/api/users/${user.id}/anime_rates?limit=5000`),
      getJson(`${HOST}/api/users/${user.id}/manga_rates?limit=5000`)
    ])
    const items = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((anime ?? []) as any[]).map((r) => mapRate(r, 'anime')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((manga ?? []) as any[]).map((r) => mapRate(r, 'manga'))
    ].filter((x): x is LibraryImport => x != null)
    env.service.importLibrary('shikimori', items, { removeMissing: true })
    env.setState({
      connected: true,
      account: user.nickname,
      avatar: abs(user.image?.x160 ?? user.avatar),
      detail: ru ? `${items.length} тайтлов` : `${items.length} titles`
    })
  }
}

export async function searchShikimori(kind: 'anime' | 'manga', query: string): Promise<LibrarySearchResult[]> {
  const list = await getJson(`${HOST}/api/${kind === 'anime' ? 'animes' : 'mangas'}?search=${encodeURIComponent(query)}&limit=12`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((list ?? []) as any[]).map((t) => ({
    kind,
    title: t.russian || t.name,
    originalTitle: t.name ?? '',
    coverUrl: abs(t.image?.original),
    year: Number(String(t.aired_on ?? '').slice(0, 4)) || null,
    total: (kind === 'anime' ? t.episodes : t.chapters) || null,
    format: t.kind ?? '',
    url: abs(t.url),
    source: 'shikimori'
  }))
}
