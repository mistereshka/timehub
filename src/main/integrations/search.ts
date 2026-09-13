import type { LibraryKind, LibrarySearchResult } from '@shared/types'
import { searchLib } from './anilib'
import type { Connector, Env } from './connections'
import { getJson } from './http'
import { searchShikimori } from './shikimori'
import { steamHeader, steamStore } from './steam'

async function openLibrary(query: string): Promise<LibrarySearchResult[]> {
  const r = await getJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=12&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r?.docs ?? []).map((d: any) => ({
    kind: 'book' as const,
    title: d.title,
    originalTitle: (d.author_name ?? []).slice(0, 2).join(', '),
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    year: d.first_publish_year ?? null,
    total: d.number_of_pages_median ?? null,
    format: '',
    url: d.key ? `https://openlibrary.org${d.key}` : null,
    source: 'openlibrary'
  }))
}

async function steamStoreSearch(query: string): Promise<LibrarySearchResult[]> {
  const r = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=russian&cc=RU`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r?.items ?? []).slice(0, 12).map((g: any) => ({
    kind: 'game' as const,
    title: g.name,
    originalTitle: '',
    coverUrl: steamHeader(String(g.id)),
    year: null,
    total: null,
    format: 'Steam',
    url: steamStore(String(g.id)),
    source: 'steam'
  }))
}

async function tmdb(kind: 'movie' | 'series', query: string, apiKey: string, lang: string): Promise<LibrarySearchResult[]> {
  const type = kind === 'movie' ? 'movie' : 'tv'
  const r = await getJson(
    `https://api.themoviedb.org/3/search/${type}?query=${encodeURIComponent(query)}&language=${lang === 'ru' ? 'ru-RU' : 'en-US'}&api_key=${encodeURIComponent(apiKey)}`
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r?.results ?? []).slice(0, 12).map((m: any) => ({
    kind,
    title: m.title ?? m.name,
    originalTitle: m.original_title ?? m.original_name ?? '',
    coverUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    year: Number(String(m.release_date ?? m.first_air_date ?? '').slice(0, 4)) || null,
    total: null,
    format: kind === 'movie' ? (lang === 'ru' ? 'Фильм' : 'Movie') : lang === 'ru' ? 'Сериал' : 'Series',
    url: `https://www.themoviedb.org/${type}/${m.id}`,
    source: 'tmdb'
  }))
}

/** TMDB only stores an API key for movie and series search. */
export class TmdbConnector implements Connector {
  readonly key = 'tmdb' as const
  readonly defaultEnabled = false

  async sync(env: Env): Promise<void> {
    const key = env.secret('apiKey')
    const ru = env.language() === 'ru'
    if (!key) throw new Error(ru ? 'Вставьте API-ключ TMDB' : 'Paste a TMDB API key')
    await getJson(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`)
    env.setState({ connected: true, detail: ru ? 'Поиск фильмов и сериалов включён' : 'Movie and series search enabled' })
  }
}

/** Finds titles to add to the library: AniLib/Shikimori, Open Library, Steam, TMDB. */
export async function searchLibrary(
  kind: LibraryKind,
  query: string,
  opts: { tmdbKey: string | null; language: string }
): Promise<LibrarySearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []
  switch (kind) {
    case 'anime':
    case 'manga':
      try {
        const lib = await searchLib(kind, q)
        if (lib.length) return lib
      } catch {
        // fall back to Shikimori
      }
      return searchShikimori(kind, q)
    case 'book':
      return openLibrary(q)
    case 'game':
      return steamStoreSearch(q)
    case 'movie':
    case 'series':
      return opts.tmdbKey ? tmdb(kind, q, opts.tmdbKey, opts.language) : []
  }
}
