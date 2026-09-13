import type { LibraryImport, LibraryKind, LibrarySearchResult, LibrarySource, LibraryStatus } from '@shared/types'
import type { Connector, Env } from './connections'
import { getJson } from './http'

// The Lib family (AniLib, MangaLib, RanobeLib) shares one account and one API.
const API = 'https://api.cdnlibs.org/api'

interface LibSite {
  id: number
  kind: LibraryKind
  source: LibrarySource
  base: string
  path: string
}

export const LIB_SITES: LibSite[] = [
  { id: 5, kind: 'anime', source: 'anilib', base: 'https://anilib.me', path: 'anime' },
  { id: 1, kind: 'manga', source: 'mangalib', base: 'https://mangalib.me', path: 'manga' },
  { id: 3, kind: 'book', source: 'ranobelib', base: 'https://ranobelib.me', path: 'book' }
]

// Standard folders; "favorites" is a flag in timehub rather than a status.
const FOLDER_STATUS: Record<number, LibraryStatus | 'favorite'> = {
  21: 'active', 22: 'planned', 23: 'dropped', 24: 'completed', 25: 'favorite', 26: 'rewatching', 27: 'on_hold',
  1: 'active', 2: 'planned', 3: 'dropped', 4: 'completed', 5: 'favorite'
}

export function parseLibUserId(input: string | undefined): string | null {
  if (!input) return null
  const m = /user\/(\d+)/.exec(input) ?? /^\s*(\d+)\s*$/.exec(input)
  return m ? m[1] : null
}

const headers = (siteId: number): Record<string, string> => ({ 'Site-Id': String(siteId), Referer: 'https://anilib.me/' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LibBookmark = any

export function mapLibBookmark(b: LibBookmark, site: LibSite): LibraryImport | null {
  const m = b?.media
  if (!m?.id) return null
  const watched = Number(b.meta?.item_number ?? 0) || 0
  const total = typeof m.items_count === 'number' && m.items_count > 0 ? m.items_count : null
  const latest = Number(m.metadata?.last_item?.number) || null
  const folder = FOLDER_STATUS[Number(b.status)]
  let status: LibraryStatus
  if (folder === 'favorite' || folder === undefined) status = total && watched >= total ? 'completed' : watched > 0 ? 'active' : 'planned'
  else status = folder
  const year = /(\d{4})/.exec(String(m.releaseDateString ?? ''))?.[1]
  return {
    kind: site.kind,
    externalId: String(m.id),
    title: m.rus_name || m.name,
    originalTitle: m.eng_name || m.name || '',
    coverUrl: m.cover?.default ?? m.cover?.md ?? m.cover?.thumbnail ?? null,
    status,
    favorite: folder === 'favorite',
    progress: watched,
    total,
    latest,
    rating: typeof b.rating === 'number' ? b.rating : null,
    year: year ? Number(year) : null,
    format: m.type?.label ?? '',
    url: m.slug_url ? `${site.base}/ru/${site.path}/${m.slug_url}` : null
  }
}

async function fetchBookmarks(userId: string, site: LibSite): Promise<LibraryImport[]> {
  const out: LibraryImport[] = []
  for (let page = 1; page <= 100; page++) {
    const r = await getJson(`${API}/bookmarks?user_id=${userId}&sort_by=name&sort_type=asc&status=0&page=${page}`, {
      headers: headers(site.id)
    })
    const data: LibBookmark[] = r?.data ?? []
    for (const b of data) {
      const item = mapLibBookmark(b, site)
      if (item) out.push(item)
    }
    if (!r?.meta?.next_page_url && data.length < 25) break
    if (data.length === 0) break
  }
  return out
}

/** AniLib / MangaLib / RanobeLib: imports your lists and keeps statuses in sync. */
export class AniLibConnector implements Connector {
  readonly key = 'anilib' as const
  readonly defaultEnabled = false
  readonly syncEveryMs = 30 * 60_000

  async sync(env: Env): Promise<void> {
    const ru = env.language() === 'ru'
    const userId = parseLibUserId(env.settings().profile)
    if (!userId) throw new Error(ru ? 'Вставьте ссылку на профиль AniLib' : 'Paste your AniLib profile link')
    const user = await getJson(`${API}/user/${userId}`, { headers: headers(5) })
    const counts: string[] = []
    for (const site of LIB_SITES) {
      const items = await fetchBookmarks(userId, site)
      env.service.importLibrary(site.source, items, { removeMissing: true })
      if (items.length) counts.push(`${items.length} ${KIND_WORD[site.kind][ru ? 'ru' : 'en']}`)
    }
    env.setState({
      connected: true,
      account: user?.data?.username ?? `#${userId}`,
      avatar: user?.data?.avatar?.url ?? null,
      detail: counts.join(' · ') || (ru ? 'Списки пусты' : 'Lists are empty')
    })
  }
}

const KIND_WORD: Record<LibraryKind, { ru: string; en: string }> = {
  anime: { ru: 'аниме', en: 'anime' },
  manga: { ru: 'манга', en: 'manga' },
  book: { ru: 'ранобэ', en: 'novels' },
  movie: { ru: 'фильмов', en: 'movies' },
  series: { ru: 'сериалов', en: 'series' },
  game: { ru: 'игр', en: 'games' }
}

/** Title search on AniLib (anime) or MangaLib (manga). */
export async function searchLib(kind: 'anime' | 'manga', query: string): Promise<LibrarySearchResult[]> {
  const site = LIB_SITES.find((s) => s.kind === kind)!
  const r = await getJson(`${API}/${kind === 'anime' ? 'anime' : 'manga'}?q=${encodeURIComponent(query)}`, { headers: headers(site.id) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r?.data ?? []).slice(0, 12).map((m: any) => ({
    kind,
    title: m.rus_name || m.name,
    originalTitle: m.eng_name || m.name || '',
    coverUrl: m.cover?.default ?? m.cover?.thumbnail ?? null,
    year: Number(/(\d{4})/.exec(String(m.releaseDateString ?? ''))?.[1]) || null,
    total: typeof m.items_count === 'number' ? m.items_count : null,
    format: m.type?.label ?? '',
    url: m.slug_url ? `${site.base}/ru/${site.path}/${m.slug_url}` : null,
    source: site.source
  }))
}
