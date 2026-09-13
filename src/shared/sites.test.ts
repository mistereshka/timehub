import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../main/db'
import { Service } from './service'
import { detectSite, isBrowserExe, parseWatchTitle } from './sites'
import { MINUTE } from './time'

describe('sites in the activity history', () => {
  it('moves past browser time on known sites to those sites, once', () => {
    const now = new Date(2026, 8, 15, 20, 0, 0).getTime()
    const svc = new Service(openNodeDb(':memory:'), { now: () => now, language: 'ru' })
    const chrome = svc.ensureApp('C:/Chrome/chrome.exe', 'chrome.exe', 'Google Chrome').app
    svc.seedSession(chrome.id, 'Неудачные попытки - YouTube - Google Chrome', now - 30 * MINUTE, now - 20 * MINUTE)
    svc.seedSession(chrome.id, 'Some page - Google Chrome', now - 20 * MINUTE, now - 10 * MINUTE)
    expect(svc.splitBrowserSessionsBySite()).toBe(1)
    expect(svc.splitBrowserSessionsBySite()).toBe(0)
    const youtube = svc.listApps().find((a) => a.exePath === 'site:youtube')!
    expect(youtube).toMatchObject({ displayName: 'YouTube', exeName: 'youtube.com' })
    expect(youtube.categoryId).toBe(svc.listCategories().find((c) => c.key === 'media')!.id)
    const usage = svc.getUsage(now - DAY_MS, now)
    expect(usage.byApp.find((x) => x.id === youtube.id)?.ms).toBe(10 * MINUTE)
    expect(usage.byApp.find((x) => x.id === chrome.id)?.ms).toBe(10 * MINUTE)
  })
})

const DAY_MS = 24 * 60 * MINUTE

describe('sites', () => {
  it('finds the site in a browser window title', () => {
    expect(isBrowserExe('chrome.exe')).toBe(true)
    expect(detectSite('(115) Неудачные попытки избавиться от видео - YouTube - Google Chrome')).toMatchObject({
      key: 'youtube',
      name: 'YouTube',
      category: 'media',
      pageTitle: 'Неудачные попытки избавиться от видео'
    })
    expect(detectSite('вкусняшки из миндаля - Поиск в Google - Google Chrome')).toMatchObject({ key: 'google', pageTitle: 'вкусняшки из миндаля' })
    expect(detectSite('казуза — Яндекс: нашлось 2 млн результатов - Google Chrome')).toMatchObject({ key: 'yandex', pageTitle: 'казуза' })
    expect(detectSite('Москва — Яндекс Карты - Google Chrome')).toMatchObject({ key: 'yandex-maps', pageTitle: 'Москва' })
    expect(detectSite('mistereshka/timehub · GitHub - Google Chrome')).toMatchObject({ key: 'github', category: 'dev', pageTitle: 'mistereshka/timehub' })
    expect(detectSite('Выхода нет — Сплин — Яндекс Музыка - Google Chrome')).toMatchObject({ key: 'yandex-music', pageTitle: 'Выхода нет - Сплин' })
    expect(detectSite('YouTube - Google Chrome')).toMatchObject({ key: 'youtube', pageTitle: 'YouTube' })
  })

  it('leaves tabs of unknown sites with the browser', () => {
    expect(detectSite('Калькулятор индекса массы тела – Семейная клиника - Google Chrome')).toBeNull()
    expect(detectSite('Some page - Google Chrome')).toBeNull()
    expect(detectSite('')).toBeNull()
  })

  it('reads what is being watched on NewDeaf', () => {
    const site = detectSite('NewDeaf | Сериал В четыре руки 1 сезон 6 серия с русскими субтитрами - Google Chrome')!
    expect(site.key).toBe('newdeaf')
    expect(parseWatchTitle(site.pageTitle)).toEqual({ kind: 'series', name: 'В четыре руки', season: 1, episode: 6, year: null })
    expect(parseWatchTitle('Фильм Дюна (2021) с русскими субтитрами')).toEqual({ kind: 'movie', name: 'Дюна', season: null, episode: null, year: 2021 })
    expect(parseWatchTitle('Аниме Фрирен 1 сезон 3 серия')).toMatchObject({ kind: 'anime', name: 'Фрирен', episode: 3 })
    expect(parseWatchTitle('Новый мир глухих: фильмы, сериалы')).toBeNull()
  })
})
