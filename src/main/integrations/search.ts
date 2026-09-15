import type { LibraryKind, LibrarySearchResult } from '@shared/types'
import { searchLib } from './anilib'
import type { Connector, Env } from './connections'
import { getJson } from './http'
import { searchNewDeaf } from './newdeaf'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ItunesAlbum = any

const artwork = (a: ItunesAlbum): string | null =>
  a.artworkUrl100 ? String(a.artworkUrl100).replace(/\/\d+x\d+bb\./, '/600x600bb.') : null

async function itunesSearch(term: string, limit: number, country?: string): Promise<ItunesAlbum[]> {
  const r = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=album&limit=${limit}${country ? `&country=${country}` : ''}`
  )
  return r?.results ?? []
}

async function itunesAlbums(query: string, language: string): Promise<LibrarySearchResult[]> {
  let list = await itunesSearch(query, 12)
  if (!list.length && language === 'ru') list = await itunesSearch(query, 12, 'RU')
  return list.map((a) => ({
    kind: 'music' as const,
    title: a.collectionName,
    originalTitle: a.artistName ?? '',
    coverUrl: artwork(a),
    year: Number(String(a.releaseDate ?? '').slice(0, 4)) || null,
    total: a.trackCount ?? null,
    format: language === 'ru' ? 'Альбом' : 'Album',
    url: a.collectionViewUrl ?? null,
    source: 'itunes'
  }))
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s*[-–(].*(single|ep|deluxe|remaster).*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Album art for music the tracker heard: the best iTunes match for the artist (and album). */
export async function itunesCover(artist: string, album: string): Promise<string | null> {
  const a = norm(artist)
  const b = norm(album)
  if (!a) return null
  for (const country of [undefined, 'RU']) {
    const list = await itunesSearch(`${artist} ${album}`.trim(), 10, country)
    const byArtist = list.filter((x) => {
      const name = norm(x.artistName ?? '')
      return name !== '' && (name.includes(a) || a.includes(name))
    })
    const hit = (b && byArtist.find((x) => norm(x.collectionName ?? '').includes(b))) || byArtist[0]
    if (hit) return artwork(hit)
  }
  return null
}

/** Album art for a single track — for players (a browser tab) that report no picture. */
export async function itunesTrackCover(artist: string, title: string): Promise<string | null> {
  const a = norm(artist)
  const t = norm(title)
  if (!a || !t) return null
  for (const country of [undefined, 'RU']) {
    const r = await getJson(
      `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&media=music&entity=song&limit=10${country ? `&country=${country}` : ''}`
    )
    const list: ItunesAlbum[] = r?.results ?? []
    const byArtist = list.filter((x) => {
      const name = norm(x.artistName ?? '')
      return name !== '' && (name.includes(a) || a.includes(name))
    })
    const hit = byArtist.find((x) => norm(x.trackName ?? '').includes(t)) ?? byArtist[0]
    if (hit) return artwork(hit)
  }
  return null
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
  opts: { tmdbKey: string | null; newdeafBase: string | null; language: string }
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
    case 'series': {
      // Posters and pages from NewDeaf first; TMDB (needs a key) as a fallback.
      if (opts.newdeafBase) {
        try {
          const found = await searchNewDeaf(opts.newdeafBase, q)
          const ofKind = found.filter((r) => r.kind === kind)
          if (ofKind.length || found.length) return ofKind.length ? ofKind : found
        } catch {
          // fall back to TMDB
        }
      }
      return opts.tmdbKey ? tmdb(kind, q, opts.tmdbKey, opts.language) : []
    }
    case 'music':
      return itunesAlbums(q, opts.language)
  }
}
