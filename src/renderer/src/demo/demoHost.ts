import { HOST_METHODS, SERVICE_METHODS, type HostHandlers, type TimehubApi } from '@shared/api'
import { Service } from '@shared/service'
import { transaction } from '@shared/sql'
import { MINUTE, startOfDayMs, todayKey } from '@shared/time'
import type {
  ChangeTopic, ConnectionKey, ConnectionStatus, DotaMatch, DotaStats, GamePresence, InstalledGame, Lang, LibraryKind, LibrarySearchResult,
  MediaPresence, MinecraftInstance, MinecraftOverview, TrackerStatus
} from '@shared/types'
import { version } from '../../../../package.json'
import { DEMO_ACTIVITY, DEMO_CALENDAR, DEMO_GAME, DEMO_TRACKS, artDataUrl, seedDemo } from './seed'
import { openSqlJsDb } from './sqljs'

const POLL_MS = 5000

/**
 * Runs the real Service against an in-memory SQLite (WebAssembly) so the UI
 * works in a normal browser — used for screenshots and trying the app out.
 */
export async function createDemoApi(): Promise<TimehubApi> {
  const db = await openSqlJsDb()
  const listeners = new Set<(topic: ChangeTopic) => void>()
  const pending = new Set<ChangeTopic>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const emit = (topic: ChangeTopic): void => {
    pending.add(topic)
    flushTimer ??= setTimeout(() => {
      flushTimer = null
      const topics = [...pending]
      pending.clear()
      for (const t of topics) for (const listener of listeners) listener(t)
    }, 50)
  }

  // ?lang=ru|en and ?theme=light|dark|dark_dimmed make screenshots reproducible.
  const params = new URLSearchParams(window.location.search)
  const langParam = params.get('lang')
  const language: Lang =
    langParam === 'ru' || langParam === 'en' ? langParam : navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'

  let fakeNow: number | null = null
  const service = new Service(db, { language, now: () => fakeNow ?? Date.now(), onChange: emit })
  let refs: ReturnType<typeof seedDemo> | undefined
  transaction(db, () => {
    refs = seedDemo(service, language, (t) => (fakeNow = t))
  })
  const { gameAppId } = refs!
  service.generateRecurring()
  const theme = params.get('theme')
  if (theme === 'light' || theme === 'dark' || theme === 'dark_dimmed') service.updateSettings({ theme })

  // A pretend game running in the background, like Discord's "Playing …".
  const gameSince = Date.now() - 47 * MINUTE
  let gameCache: { at: number; value: GamePresence } | null = null
  const game = (): GamePresence => {
    if (gameCache && Date.now() - gameCache.at < 60_000) return gameCache.value
    const now = Date.now()
    const app = service.listApps().find((a) => a.id === gameAppId)
    const msIn = (from: number): number => service.getUsage(from, now).byApp.find((x) => x.id === gameAppId)?.ms ?? 0
    const value: GamePresence = {
      appId: gameAppId,
      displayName: DEMO_GAME.name,
      icon: app?.icon ?? null,
      since: gameSince,
      provider: 'steam',
      details: null,
      imageUrl: DEMO_GAME.header,
      playersOnline: 18_000 + Math.round(Math.random() * 900),
      storeUrl: DEMO_GAME.store,
      totalMs: msIn(0) + (now - gameSince),
      todayMs: msIn(startOfDayMs(todayKey(now))) + (now - gameSince),
      streak: service.getAppStreaks().find((s) => s.appId === gameAppId)?.streak ?? 0,
      platformPlaytimeMin: 3120
    }
    gameCache = { at: now, value }
    return value
  }

  // …and a pretend music player cycling through a short playlist.
  let track = 0
  let media: MediaPresence = trackPresence(0, Date.now() - 64_000)

  // A pretend tracker so today's schedule keeps growing while you look around.
  let status: TrackerStatus = { supported: true, state: 'active', current: null, games: [], media: null }
  const tick = (): void => {
    const now = Date.now()
    if (media.durationMs != null && now - media.updatedAt + (media.positionMs ?? 0) >= media.durationMs) {
      track = (track + 1) % DEMO_TRACKS.length
      media = trackPresence(track, now)
    }
    if (service.getSettings().trackingPaused) {
      service.closeActivity(now)
      status = { ...status, state: 'paused', current: null, games: [], media: null }
    } else {
      const r = service.recordSample({ at: now, ...DEMO_ACTIVITY, idleMs: 0 }, { intervalMs: POLL_MS, idleThresholdMs: 5 * MINUTE })
      if (r.state === 'active') {
        status = {
          ...status,
          state: 'active',
          current: { appId: r.app.id, displayName: r.app.displayName, icon: r.app.icon, title: r.title, since: r.since },
          games: [game()],
          media
        }
      }
    }
    emit('tracker')
  }
  tick()
  setInterval(tick, POLL_MS)

  const connections = demoConnections(language)
  const patchConnection = (key: ConnectionKey, patch: Partial<ConnectionStatus>): ConnectionStatus => {
    const next = { ...connections.get(key)!, ...patch }
    connections.set(key, next)
    emit('connections')
    return next
  }

  const minecraftNames = new Map<string, string>()

  const host: HostHandlers = {
    getMeta: () => ({ version, dataPath: 'in-memory', demo: true, platform: 'web', packaged: false }),
    getTrackerStatus: () => status,
    exportData: (format) => {
      const name = `timehub-demo-${todayKey()}.${format}`
      const blob = new Blob([format === 'json' ? service.exportJson() : service.exportCsv()], {
        type: format === 'json' ? 'application/json' : 'text/csv'
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      return name
    },
    openDataFolder: () => {},
    setTitleBarTheme: () => {},
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener')
    },
    listConnections: () => [...connections.values()],
    updateConnection: (key, patch) => {
      const current = connections.get(key)!
      const secrets = Object.entries(patch.secrets ?? {})
      return patchConnection(key, {
        enabled: patch.enabled ?? current.enabled,
        settings: { ...current.settings, ...patch.settings },
        secretsSet: [
          ...current.secretsSet.filter((s) => !secrets.some(([k]) => k === s)),
          ...secrets.filter(([, v]) => v).map(([k]) => k)
        ]
      })
    },
    syncConnection: (key) => patchConnection(key, { lastSync: Date.now(), error: null }),
    connectSpotify: () => {
      throw new Error(language === 'ru' ? 'Вход через Spotify работает в приложении для Windows.' : 'Spotify sign-in works in the Windows app.')
    },
    disconnectConnection: (key) => patchConnection(key, { connected: false, account: null, avatar: null, detail: null, secretsSet: [] }),
    getGameInfo: (appId) =>
      appId === gameAppId
        ? {
            link: { appId, provider: 'steam', externalId: DEMO_GAME.steamId, name: DEMO_GAME.name, imageUrl: DEMO_GAME.header, storeUrl: DEMO_GAME.store },
            details: null,
            playersOnline: game().playersOnline,
            platformPlaytimeMin: 3120
          }
        : null,
    getSpotifyOverview: () => null,
    testReminder: () => false,
    getDotaStats: () => demoDota(language),
    scanMusic: () => ({ folders: [], tracks: [] }),
    addMusicFolder: () => {
      throw new Error(language === 'ru' ? 'Папки с музыкой добавляются в приложении для Windows.' : 'Music folders can be added in the Windows app.')
    },
    mediaControl: () => {},
    listGames: () => demoGames(gameAppId),
    launchGame: () => {},
    listMinecraft: () => demoMinecraft(minecraftNames),
    launchMinecraft: () => {},
    openMinecraftFolder: () => {},
    renameMinecraft: (id, name) => {
      if (name?.trim()) minecraftNames.set(id, name.trim())
      else minecraftNames.delete(id)
      emit('meta')
    },
    pickMinecraftIcon: () => false,
    clearMinecraftIcon: () => {},
    searchLibrary: (kind, query) => searchCatalog(kind, query, language)
  }

  const api: Record<string, unknown> = {}
  for (const m of SERVICE_METHODS) {
    const fn = service[m] as (...args: unknown[]) => unknown
    api[m] = async (...args: unknown[]) => fn.apply(service, args)
  }
  for (const m of HOST_METHODS) {
    const fn = host[m] as (...args: unknown[]) => unknown
    api[m] = async (...args: unknown[]) => fn(...args)
  }
  api.onChange = (listener: (topic: ChangeTopic) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return api as unknown as TimehubApi
}

/** A few installed games for the demo's Games tab. */
function demoGames(gameAppId: number): InstalledGame[] {
  const now = Date.now()
  const capsule = (id: string): string => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`
  return [
    { id: 'steam:1145350', name: 'Hades II', platform: 'steam', cover: capsule('1145350'), icon: null, appId: gameAppId, trackedMs: 150 * 3_600_000, lastPlayed: now - 3_600_000, platformMinutes: 3120 },
    { id: 'steam:367520', name: 'Hollow Knight', platform: 'steam', cover: capsule('367520'), icon: null, appId: null, trackedMs: 0, lastPlayed: now - 40 * 86_400_000, platformMinutes: 2460 },
    { id: 'steam:413150', name: 'Stardew Valley', platform: 'steam', cover: capsule('413150'), icon: null, appId: null, trackedMs: 0, lastPlayed: null, platformMinutes: 0 },
    { id: 'battlenet:Hearthstone', name: 'Hearthstone', platform: 'battlenet', cover: null, icon: null, appId: null, trackedMs: 0, lastPlayed: now - 5 * 86_400_000, platformMinutes: null },
    { id: 'epic:Fortnite', name: 'Fortnite', platform: 'epic', cover: null, icon: null, appId: null, trackedMs: 0, lastPlayed: null, platformMinutes: null }
  ]
}

/** Prism Launcher instances for the demo's Minecraft page (names you give them live in `names`). */
function demoMinecraft(names: Map<string, string>): MinecraftOverview {
  const now = Date.now()
  const h = 3_600_000
  const store = 'https://store-images.s-microsoft.com/image/'
  const instance = (
    i: Omit<MinecraftInstance, 'label' | 'autoLabel' | 'customName' | 'customIcon' | 'icon' | 'appId' | 'running'> & { auto: string }
  ): MinecraftInstance => {
    const { auto, ...rest } = i
    const custom = names.get(i.id)
    return { ...rest, label: custom ?? auto, autoLabel: auto, customName: !!custom, customIcon: false, icon: null, appId: null, running: false }
  }
  return {
    found: true,
    canLaunch: true,
    other: null,
    art: {
      poster: `${store}apps.808.14492077886571533.be42f4bd-887b-4430-8ed0-622341b4d2b0.c8274c53-105e-478b-9f4b-41b8088210a3`,
      banner: `${store}apps.58378.14492077886571533.338a563a-86e7-47b1-b9dc-41cf411f5dcd.dc840f22-6e8f-4a59-b7bc-57958a0740fd`,
      logo: `${store}apps.2726.14492077886571533.be42f4bd-887b-4430-8ed0-622341b4d2b0.b7314828-2896-431a-b863-1e3de670a5b2`
    },
    instances: [
      instance({
        id: 'Create Above and Beyond', name: 'Create: Above and Beyond', auto: 'Create: Above and Beyond · Forge', mcVersion: '1.18.2',
        loader: 'Forge', loaderVersion: '40.2.0', modCount: 187, prismMs: 42 * h, lastLaunch: now - 5 * h, trackedMs: 11 * h, lastPlayed: now - 3 * h
      }),
      instance({
        id: 'Fabulously Optimized', name: 'Fabulously Optimized', auto: 'Fabulously Optimized · Fabric', mcVersion: '1.21.1',
        loader: 'Fabric', loaderVersion: '0.16.5', modCount: 64, prismMs: 9 * h, lastLaunch: now - 96 * h, trackedMs: 2 * h, lastPlayed: now - 96 * h
      }),
      instance({
        id: '1.21.1', name: '1.21.1', auto: '1.21.1 · Vanilla', mcVersion: '1.21.1', loader: null, loaderVersion: null, modCount: 0,
        prismMs: 40 * 60_000, lastLaunch: now - 720 * h, trackedMs: 0, lastPlayed: null
      })
    ]
  }
}

/** Sample Dota 2 stats for the demo (hero art comes from Valve's CDN). */
function demoDota(lang: Lang): DotaStats {
  const heroes: [number, string, string][] = [
    [74, 'Invoker', 'invoker'], [14, 'Pudge', 'pudge'], [8, 'Juggernaut', 'juggernaut'], [5, 'Crystal Maiden', 'crystal_maiden'],
    [2, 'Axe', 'axe'], [25, 'Lina', 'lina']
  ]
  const img = (npc: string): string => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${npc}.png`
  const now = Date.now()
  const recent: DotaMatch[] = Array.from({ length: 10 }, (_, i) => {
    const [heroId, hero, npc] = heroes[i % heroes.length]
    const win = [0, 1, 3, 4, 7, 9].includes(i)
    return {
      matchId: String(8_100_000_000 + i), heroId, hero, heroImage: img(npc), win, kills: 4 + ((i * 3) % 9), deaths: 2 + ((i * 5) % 7),
      assists: 6 + ((i * 7) % 11), durationSec: 1800 + i * 137, startTime: now - (i + 1) * 5 * 3_600_000,
      mode: i % 3 === 0 ? (lang === 'ru' ? 'Турбо' : 'Turbo') : lang === 'ru' ? 'Все выбирают' : 'All Pick', ranked: i % 3 !== 0,
      gpm: 420 + i * 13, xpm: 510 + i * 11, lastHits: 120 + i * 9
    }
  })
  return {
    accounts: [{ accountId: '1', name: 'demo_player', avatar: null, matches: 231 }],
    accountId: '1', name: 'demo_player', avatar: null, rankTier: 44, leaderboardRank: null, wins: 120, losses: 111, recent,
    heroes: heroes.map(([heroId, hero, npc], i) => ({ heroId, hero, heroImage: img(npc), games: 60 - i * 8, wins: 33 - i * 5, lastPlayed: now - i * 86_400_000 })),
    avg: { kills: 7.8, deaths: 5.1, assists: 11.2, gpm: 478, xpm: 561 },
    profileUrl: 'https://www.dotabuff.com/players/1'
  }
}

function trackPresence(i: number, startedAt: number): MediaPresence {
  const t = DEMO_TRACKS[i]
  return {
    source: 'Spotify.exe',
    sourceName: 'Spotify',
    title: t.title,
    artist: t.artist,
    album: t.album,
    playing: true,
    kind: 'music',
    positionMs: 0,
    durationMs: t.sec * 1000,
    updatedAt: startedAt,
    thumbnail: artDataUrl(t.title, t.hue)
  }
}

function demoConnections(lang: Lang): Map<ConnectionKey, ConnectionStatus> {
  const ru = lang === 'ru'
  const hour = 60 * MINUTE
  const base = (key: ConnectionKey, patch: Partial<ConnectionStatus> = {}): ConnectionStatus => ({
    key, enabled: false, connected: false, account: null, avatar: null, detail: null, error: null, lastSync: null,
    settings: {}, secretsSet: [], ...patch
  })
  const list: ConnectionStatus[] = [
    base('steam', { enabled: true, connected: true, account: 'demo_player', detail: ru ? '42 игры в библиотеке · 18 установлено' : '42 games in the library · 18 installed', lastSync: Date.now() - 2 * hour }),
    base('roblox', { enabled: true, connected: true, detail: ru ? 'Ждёт, пока вы зайдёте в игру' : 'Waiting for you to join an experience' }),
    base('epic', { enabled: true, connected: true, detail: ru ? '3 игры установлено' : '3 games installed', lastSync: Date.now() - 2 * hour }),
    base('battlenet', { enabled: true, connected: true, detail: ru ? 'Игр установлено: 1 · Hearthstone' : '1 installed · Hearthstone' }),
    base('newdeaf', { enabled: true, connected: true, detail: ru ? 'В библиотеке: 2' : 'In the library: 2' }),
    base('media', { enabled: true, connected: true, detail: ru ? 'Сейчас: Spotify' : 'Now: Spotify' }),
    base('spotify'),
    base('discord', { settings: { mode: 'timer' } }),
    base('anilib', {
      enabled: true, connected: true, account: 'demo', detail: ru ? '22 тайтла · 2 новые серии' : '22 titles · 2 new episodes',
      settings: { profile: 'https://anilib.me/ru/user/1' }, lastSync: Date.now() - 12 * MINUTE
    }),
    base('shikimori'),
    base('tmdb'),
    base('github', {
      enabled: true, connected: true, account: 'demo', detail: ru ? 'Вклады за последний год' : 'Contributions from the last year',
      settings: { username: 'demo' }, lastSync: Date.now() - 40 * MINUTE
    }),
    base('calendar', {
      enabled: true, connected: true, detail: ru ? '1 календарь' : '1 calendar',
      settings: { sources: JSON.stringify([{ id: DEMO_CALENDAR, name: ru ? 'Работа' : 'Work', url: 'https://example.com/work.ics', color: '#0969da' }]) },
      lastSync: Date.now() - 25 * MINUTE
    })
  ]
  return new Map(list.map((c) => [c.key, c]))
}

const CATALOG: (Omit<LibrarySearchResult, 'title' | 'coverUrl' | 'source' | 'url'> & { title: Record<Lang, string> })[] = [
  { kind: 'anime', title: { en: 'Frieren: Beyond Journey’s End', ru: 'Провожающая в последний путь Фрирен' }, originalTitle: 'Sousou no Frieren', year: 2023, total: 28, format: 'TV' },
  { kind: 'anime', title: { en: 'Dandadan', ru: 'Дандадан' }, originalTitle: 'Dandadan', year: 2024, total: 12, format: 'TV' },
  { kind: 'anime', title: { en: 'Your Name', ru: 'Твоё имя' }, originalTitle: 'Kimi no Na wa.', year: 2016, total: 1, format: 'Movie' },
  { kind: 'manga', title: { en: 'Berserk', ru: 'Берсерк' }, originalTitle: 'Berserk', year: 1989, total: null, format: 'Manga' },
  { kind: 'manga', title: { en: 'One Punch-Man', ru: 'Ванпанчмен' }, originalTitle: 'One Punch-Man', year: 2012, total: null, format: 'Manga' },
  { kind: 'book', title: { en: 'The Pragmatic Programmer', ru: 'Программист-прагматик' }, originalTitle: 'The Pragmatic Programmer', year: 1999, total: 352, format: '' },
  { kind: 'book', title: { en: 'Project Hail Mary', ru: 'Проект «Аве Мария»' }, originalTitle: 'Project Hail Mary', year: 2021, total: 496, format: '' },
  { kind: 'book', title: { en: 'Master and Margarita', ru: 'Мастер и Маргарита' }, originalTitle: 'Мастер и Маргарита', year: 1967, total: 480, format: '' },
  { kind: 'movie', title: { en: 'Interstellar', ru: 'Интерстеллар' }, originalTitle: 'Interstellar', year: 2014, total: 1, format: 'Movie' },
  { kind: 'movie', title: { en: 'Spirited Away', ru: 'Унесённые призраками' }, originalTitle: 'Sen to Chihiro no Kamikakushi', year: 2001, total: 1, format: 'Movie' },
  { kind: 'series', title: { en: 'Severance', ru: 'Разделение' }, originalTitle: 'Severance', year: 2022, total: 19, format: 'TV' },
  { kind: 'series', title: { en: 'Shōgun', ru: 'Сёгун' }, originalTitle: 'Shōgun', year: 2024, total: 10, format: 'TV' },
  { kind: 'game', title: { en: 'Hollow Knight: Silksong', ru: 'Hollow Knight: Silksong' }, originalTitle: '', year: 2025, total: null, format: 'Steam' },
  { kind: 'game', title: { en: 'Elden Ring', ru: 'Elden Ring' }, originalTitle: '', year: 2022, total: null, format: 'Steam' },
  { kind: 'game', title: { en: 'Balatro', ru: 'Balatro' }, originalTitle: '', year: 2024, total: null, format: 'Steam' }
]

function searchCatalog(kind: LibraryKind, query: string, lang: Lang): LibrarySearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return CATALOG.filter((c) => c.kind === kind)
    .filter((c) => [c.title.en, c.title.ru, c.originalTitle].some((s) => s.toLowerCase().includes(q)))
    .map((c) => ({ ...c, title: c.title[lang], coverUrl: null, url: null, source: 'demo' }))
}
