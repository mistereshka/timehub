import type { LibraryImport, LibraryKind, LibrarySearchResult } from '@shared/types'
import { parseWatchTitle } from '@shared/sites'
import { DAY, MINUTE } from '@shared/time'
import type { Connector, Env } from './connections'

/** The site moves between mirrors (13sep.newdeaf.co…); the address is a setting. */
export const DEFAULT_NEWDEAF = 'https://13sep.newdeaf.co'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
/** Watching a title for this long puts it into the library. */
const WATCH_MIN_MS = 10 * MINUTE
/** A film watched this long counts as seen. */
const FILM_DONE_MS = 70 * MINUTE

export function newDeafBase(settings: Record<string, string>): string {
  const raw = (settings.site || DEFAULT_NEWDEAF).trim()
  return (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')
}

const decode = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

function sectionKind(section: string): LibraryKind {
  if (/serial|multserial/i.test(section)) return 'series'
  if (/anime/i.test(section)) return 'anime'
  return 'movie'
}

/** Poster links from a NewDeaf listing or search page (DLE markup, lazy images in data-src). */
export function parseNewDeafResults(html: string): LibrarySearchResult[] {
  const out: LibrarySearchResult[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+\/([a-z-]+)\/\d+-[^"]*\.html)"[^>]*>([\s\S]{0,800}?)<\/a>/gi)) {
    const [, url, section, inner] = m
    if (seen.has(url)) continue
    const cover = /data-src="([^"]+)"/.exec(inner)?.[1] ?? /\ssrc="(https?:[^"]+)"/.exec(inner)?.[1]
    const alt = /alt="([^"]+)"/.exec(inner)?.[1]
    if (!cover || !alt) continue // plain text links repeat the poster ones
    seen.add(url)
    const kind = sectionKind(section)
    out.push({
      kind,
      title: decode(alt)
        .replace(/\s*[-–—]\s*NewDeaf.*$/i, '')
        .trim(),
      originalTitle: '',
      coverUrl: cover,
      year: null,
      total: null,
      format: kind === 'series' ? 'Сериал' : kind === 'anime' ? 'Аниме' : 'Фильм',
      url,
      source: 'newdeaf'
    })
  }
  return out
}

export async function searchNewDeaf(base: string, query: string): Promise<LibrarySearchResult[]> {
  const res = await fetch(`${base}/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`NewDeaf: HTTP ${res.status}`)
  return parseNewDeafResults(await res.text())
}

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * What you watch on NewDeaf goes to the library: a film or series page open
 * for 10+ minutes becomes an item with the site's poster; series keep the
 * last episode you reached.
 */
export class NewDeafConnector implements Connector {
  readonly key = 'newdeaf' as const
  readonly defaultEnabled = true
  readonly syncEveryMs = 5 * 60_000
  private readonly found = new Map<string, LibrarySearchResult | null>()

  async sync(env: Env): Promise<void> {
    const ru = env.language() === 'ru'
    const now = Date.now()
    const site = env.service.listApps().find((a) => a.exePath === 'site:newdeaf')
    if (!site) {
      env.setState({ connected: true, detail: ru ? 'Ждёт, пока вы что-нибудь посмотрите' : 'Waiting for you to watch something' })
      return
    }
    const watched = new Map<string, { kind: LibraryKind; name: string; season: number | null; episode: number; year: number | null; ms: number }>()
    for (const s of env.service.listSessions(now - 7 * DAY, now)) {
      if (s.appId !== site.id) continue
      const w = parseWatchTitle(s.title)
      if (!w) continue
      const id = `${w.kind}:${norm(w.name)}${w.kind !== 'movie' && w.season ? `:s${w.season}` : ''}`
      const cur = watched.get(id) ?? { ...w, episode: 0, ms: 0 }
      cur.ms += s.end - s.start
      cur.episode = Math.max(cur.episode, w.episode ?? 0)
      watched.set(id, cur)
    }
    const base = newDeafBase(env.settings())
    const items: LibraryImport[] = []
    for (const [id, w] of watched) {
      if (w.ms < WATCH_MIN_MS) continue
      const hit = await this.lookup(base, w.name, w.kind)
      const film = w.kind === 'movie'
      const done = film && w.ms >= FILM_DONE_MS
      items.push({
        kind: w.kind,
        externalId: id,
        title: !film && w.season ? `${w.name} (${w.season} ${ru ? 'сезон' : 'season'})` : w.name,
        coverUrl: hit?.coverUrl ?? null,
        url: hit?.url ?? null,
        year: w.year,
        format: hit?.format ?? '',
        status: done ? 'completed' : 'active',
        progress: film ? (done ? 1 : 0) : w.episode,
        total: film ? 1 : null
      })
    }
    if (items.length) env.service.importLibrary('newdeaf', items)
    const total = env.service.listLibrary().filter((i) => i.source === 'newdeaf').length
    env.setState({
      connected: true,
      detail: total ? (ru ? `В библиотеке: ${total}` : `In the library: ${total}`) : ru ? 'Ждёт, пока вы что-нибудь посмотрите' : 'Waiting for you to watch something'
    })
  }

  /** The site's own page and poster for a title (cached; a miss is remembered too). */
  private async lookup(base: string, name: string, kind: LibraryKind): Promise<LibrarySearchResult | null> {
    const key = `${kind}:${norm(name)}`
    if (this.found.has(key)) return this.found.get(key) ?? null
    let hit: LibrarySearchResult | null = null
    try {
      const results = await searchNewDeaf(base, name)
      const want = norm(name)
      hit =
        results.find((r) => r.kind === kind && norm(r.title) === want) ??
        results.find((r) => norm(r.title) === want) ??
        results.find((r) => r.kind === kind && norm(r.title).includes(want)) ??
        null
    } catch {
      // no cover this time; try again after the next launch
    }
    this.found.set(key, hit)
    return hit
  }
}
