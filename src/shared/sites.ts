import type { CategoryKey } from './catalog'
import type { LibraryKind } from './types'

const BROWSER_EXES = new Set([
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'browser.exe', 'opera.exe', 'opera_gx.exe', 'brave.exe', 'vivaldi.exe',
  'arc.exe', 'zen.exe', 'librewolf.exe', 'waterfox.exe', 'thorium.exe'
])
export const isBrowserExe = (exeName: string): boolean => BROWSER_EXES.has(exeName.toLowerCase())

// " - Google Chrome", " — Mozilla Firefox", " - Microsoft Edge" (Edge puts an invisible space inside), " - Яндекс Браузер"…
const BROWSER_SUFFIX =
  /\s[-–—]\s(Google Chrome|Chromium|Microsoft.{0,2}Edge|Mozilla Firefox|Firefox|Opera GX|Opera|Brave|Vivaldi|Яндекс\sБраузер|Yandex Browser|Arc|Zen Browser|LibreWolf|Waterfox|Thorium)$/i

/** Separators between a page title and the site name: "Video - YouTube", "repo · GitHub", "NewDeaf | Film". */
const SEPARATOR = /\s[-–—|·/]\s/

export interface SiteDef {
  key: string
  name: string
  domain: string
  category: CategoryKey
  /** Matches the site's own segment of the tab title */
  pattern: RegExp
}

/** Known sites, most specific first. Unknown tabs stay with the browser. */
export const SITES: SiteDef[] = [
  { key: 'youtube-music', name: 'YouTube Music', domain: 'music.youtube.com', category: 'media', pattern: /^YouTube Music$/i },
  { key: 'youtube', name: 'YouTube', domain: 'youtube.com', category: 'media', pattern: /^YouTube$/i },
  { key: 'twitch', name: 'Twitch', domain: 'twitch.tv', category: 'media', pattern: /^Twitch$/i },
  { key: 'yandex-music', name: 'Яндекс Музыка', domain: 'music.yandex.ru', category: 'media', pattern: /Яндекс\sМузык|Yandex\sMusic/i },
  { key: 'kinopoisk', name: 'Кинопоиск', domain: 'kinopoisk.ru', category: 'media', pattern: /^(Кинопоиск|Kinopoisk)/i },
  { key: 'netflix', name: 'Netflix', domain: 'netflix.com', category: 'media', pattern: /^Netflix$/i },
  { key: 'newdeaf', name: 'NewDeaf', domain: 'newdeaf.co', category: 'media', pattern: /^NewDeaf$|Новый мир глухих/i },
  { key: 'anilib', name: 'AniLib', domain: 'anilib.me', category: 'media', pattern: /^(AniLib|Анилиб)/i },
  { key: 'mangalib', name: 'MangaLib', domain: 'mangalib.me', category: 'media', pattern: /^(MangaLib|Мангалиб)/i },
  { key: 'animego', name: 'AnimeGO', domain: 'animego.me', category: 'media', pattern: /AnimeGO/i },
  { key: 'jutsu', name: 'Jut.su', domain: 'jut.su', category: 'media', pattern: /jut\.su/i },
  { key: 'anilibria', name: 'AniLibria', domain: 'anilibria.top', category: 'media', pattern: /AniLibria|AniLiberty/i },
  { key: 'yummyanime', name: 'YummyAnime', domain: 'yummyani.me', category: 'media', pattern: /Yummy\s?Ani/i },
  { key: 'shikimori', name: 'Shikimori', domain: 'shikimori.one', category: 'media', pattern: /^(Шикимори|Shikimori)$/i },
  { key: 'google', name: 'Google', domain: 'google.com', category: 'browser', pattern: /^(Поиск в Google|Google Search|Google Поиск)$/i },
  { key: 'yandex', name: 'Яндекс', domain: 'ya.ru', category: 'browser', pattern: /^Яндекс:\s|^Поиск Яндекса$/ },
  { key: 'yandex-maps', name: 'Яндекс Карты', domain: 'yandex.ru', category: 'other', pattern: /^Яндекс\sКарты$/i },
  { key: 'google-maps', name: 'Google Карты', domain: 'maps.google.com', category: 'other', pattern: /^(Google Карты|Google Maps)$/i },
  { key: 'wikipedia', name: 'Википедия', domain: 'wikipedia.org', category: 'browser', pattern: /^(Википедия|Wikipedia)$/i },
  { key: 'vk', name: 'ВКонтакте', domain: 'vk.com', category: 'social', pattern: /^(ВКонтакте|VK)$/ },
  { key: 'reddit', name: 'Reddit', domain: 'reddit.com', category: 'social', pattern: /^Reddit$/i },
  { key: 'x', name: 'X', domain: 'x.com', category: 'social', pattern: /^X$/ },
  { key: 'github', name: 'GitHub', domain: 'github.com', category: 'dev', pattern: /^GitHub$/i },
  { key: 'stackoverflow', name: 'Stack Overflow', domain: 'stackoverflow.com', category: 'dev', pattern: /^Stack Overflow( на русском)?$/i },
  { key: 'habr', name: 'Хабр', domain: 'habr.com', category: 'dev', pattern: /^(Хабр|Habr)$/i },
  { key: 'chatgpt', name: 'ChatGPT', domain: 'chatgpt.com', category: 'work', pattern: /^ChatGPT$/i },
  { key: 'claude', name: 'Claude', domain: 'claude.ai', category: 'work', pattern: /^Claude$/ },
  { key: 'gmail', name: 'Gmail', domain: 'mail.google.com', category: 'work', pattern: /^Gmail$/i },
  {
    key: 'google-docs', name: 'Google Документы', domain: 'docs.google.com', category: 'work',
    pattern: /^Google (Документы|Docs|Таблицы|Sheets|Презентации|Slides|Диск|Drive)$/i
  },
  { key: 'figma', name: 'Figma', domain: 'figma.com', category: 'work', pattern: /^Figma$/i }
]

export interface SiteMatch {
  key: string
  name: string
  domain: string
  category: CategoryKey
  /** The tab title without the site and browser names, e.g. the video title */
  pageTitle: string
}

/** "Video - YouTube - Google Chrome" → YouTube + "Video". Null for tabs of unknown sites. */
export function detectSite(windowTitle: string): SiteMatch | null {
  const tab = windowTitle.replace(BROWSER_SUFFIX, '').trim()
  if (!tab) return null
  const parts = tab.split(SEPARATOR).map((p) => p.trim())
  for (const site of SITES) {
    // the site's name ends the title ("… - YouTube") or starts it ("NewDeaf | …")
    const idx = [parts.length - 1, 0].find((i) => site.pattern.test(parts[i]))
    if (idx == null) continue
    const rest = parts
      .filter((_, i) => i !== idx)
      .join(' - ')
      .replace(/^\(\d+\)\s*/, '') // "(115) Video" — unread notifications
      .trim()
    return { key: site.key, name: site.name, domain: site.domain, category: site.category, pageTitle: rest || site.name }
  }
  return null
}

export interface WatchTitle {
  kind: LibraryKind
  name: string
  season: number | null
  episode: number | null
  year: number | null
}

const KIND_WORDS: [RegExp, LibraryKind][] = [
  [/^Мультсериал\s+/i, 'series'],
  [/^Сериал\s+/i, 'series'],
  [/^Аниме\s+/i, 'anime'],
  [/^Мультфильм\s+/i, 'movie'],
  [/^Фильм\s+/i, 'movie']
]

/** "Сериал В четыре руки 1 сезон 6 серия с русскими субтитрами" → a series, season 1, episode 6. */
export function parseWatchTitle(pageTitle: string): WatchTitle | null {
  let rest = pageTitle.trim()
  let kind: LibraryKind | null = null
  for (const [re, k] of KIND_WORDS) {
    if (re.test(rest)) {
      kind = k
      rest = rest.replace(re, '')
      break
    }
  }
  if (!kind) return null
  rest = rest
    .replace(/\s*(с\s+)?(русскими\s+)?субтитрами.*$/i, '')
    .replace(/\s*смотреть\s+онлайн.*$/i, '')
    .trim()
  const season = /(\d+)\s*сезон/i.exec(rest)
  const episode = /(\d+)\s*сери[яи]/i.exec(rest)
  const year = /\((\d{4})\)/.exec(rest)
  const name = rest
    .replace(/\s*\d+\s*сезон.*$/i, '')
    .replace(/\s*\d+\s*сери[яи].*$/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()
  if (!name) return null
  return {
    kind,
    name,
    season: season ? Number(season[1]) : null,
    episode: episode ? Number(episode[1]) : null,
    year: year ? Number(year[1]) : null
  }
}
