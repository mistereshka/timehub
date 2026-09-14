import { describe, expect, it } from 'vitest'
import { parseVdf, vdfGet } from './vdf'
import { parseRobloxLog } from './roblox'
import { expandIcs } from './calendar'
import { LIB_SITES, mapLibBookmark, parseLibUserId } from './anilib'
import { mergePlaytime, uniqueLibraries, type Playtime } from './steam'

describe('steam libraries', () => {
  it('reads a library once however its path is spelled', () => {
    expect(uniqueLibraries(['c:/program files (x86)/steam', String.raw`C:\Program Files (x86)\Steam`, 'D:/SteamLibrary/', 'd:/steamlibrary'])).toEqual([
      'c:/program files (x86)/steam',
      'D:/SteamLibrary/'
    ])
  })
})
import { blizzardGames, parseUninstall } from './battlenet'
import { parseNewDeafResults } from './newdeaf'

describe('battle.net', () => {
  it('finds Blizzard games in the uninstall registry', () => {
    const text = String.raw`
HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Hearthstone
    DisplayName    REG_SZ    Hearthstone
    InstallLocation    REG_SZ    C:\Program Files (x86)\Hearthstone
    Publisher    REG_SZ    Blizzard Entertainment

HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Battle.net
    DisplayName    REG_SZ    Battle.net
    InstallLocation    REG_SZ    C:\Program Files (x86)\Battle.net
    Publisher    REG_SZ    Blizzard Entertainment

HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\7-Zip
    DisplayName    REG_SZ    7-Zip
    Publisher    REG_SZ    Igor Pavlov
`
    expect(blizzardGames(parseUninstall(text))).toEqual([
      { key: 'Hearthstone', name: 'Hearthstone', installDir: String.raw`C:\Program Files (x86)\Hearthstone` }
    ])
  })
})

describe('newdeaf', () => {
  it('reads posters and links from a listing', () => {
    const html = `
<div class="th-item"><a class="th-in" href="https://13sep.newdeaf.co/serial/13609-v-chetyre-ruki-1-season-subtitry.html">
  <div class="th-img"><img src="data:image/png;base64,AAAA" data-src="https://static.cdnlbox.club/poster/web/2026/e6be.webp" alt="В четыре руки - NewDeaf с субтитрами"></div></a></div>
<a href="https://13sep.newdeaf.co/film/100-dyuna-subtitry.html"><img data-src="https://static.cdnlbox.club/poster/web/2021/dune.webp" alt="Дюна - NewDeaf с субтитрами"></a>
<a href="https://13sep.newdeaf.co/serial/13609-v-chetyre-ruki-1-season-subtitry.html">В четыре руки</a>`
    expect(parseNewDeafResults(html)).toEqual([
      {
        kind: 'series', title: 'В четыре руки', originalTitle: '', coverUrl: 'https://static.cdnlbox.club/poster/web/2026/e6be.webp', year: null,
        total: null, format: 'Сериал', url: 'https://13sep.newdeaf.co/serial/13609-v-chetyre-ruki-1-season-subtitry.html', source: 'newdeaf'
      },
      {
        kind: 'movie', title: 'Дюна', originalTitle: '', coverUrl: 'https://static.cdnlbox.club/poster/web/2021/dune.webp', year: null,
        total: null, format: 'Фильм', url: 'https://13sep.newdeaf.co/film/100-dyuna-subtitry.html', source: 'newdeaf'
      }
    ])
  })
})

describe('steam accounts', () => {
  it('adds up playtime of the same game across accounts', () => {
    const map = new Map<string, Playtime>()
    mergePlaytime(map, '570', { minutes: 600, lastPlayed: 1000 })
    mergePlaytime(map, '730', { minutes: 30, lastPlayed: 500 })
    mergePlaytime(map, '570', { minutes: 120, lastPlayed: 3000 })
    expect(map.get('570')).toEqual({ minutes: 720, lastPlayed: 3000 })
    expect(map.get('730')).toEqual({ minutes: 30, lastPlayed: 500 })
  })
})

describe('vdf', () => {
  it('parses Steam key-values with escapes and nesting', () => {
    const text = `"libraryfolders"
{
  // comment
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
    "apps" { "1145350" "123" }
  }
}`
    const v = parseVdf(text)
    expect(vdfGet(v, 'LibraryFolders', '0', 'path')).toBe('C:\\Program Files (x86)\\Steam')
    expect(vdfGet(v, 'libraryfolders', '0', 'apps', '1145350')).toBe('123')
  })
})

describe('roblox log', () => {
  const join = `2026-09-13T10:00:00Z,1.0,abc,6 [FLog::Output] ! Joining game 'a1b2c3d4-0000-0000-0000-123456789abc' place 4924922222 at 128.116.1.1`
  const universe = `2026-09-13T10:00:05Z,1.0,abc,6 [FLog::GameJoinLoadTime] Report game_join_loadtime: placeid:4924922222, universeid:1686885941, userid:1`
  it('finds the experience and whether you left it', () => {
    expect(parseRobloxLog([join, universe].join('\n'))).toEqual({ join: { placeId: '4924922222', universeId: '1686885941' }, left: false })
    expect(parseRobloxLog([join, universe, '[FLog::SingleSurfaceApp] leaveUGCGameInternal'].join('\n')).left).toBe(true)
    expect(parseRobloxLog('[FLog::Systray] started').join).toBeNull()
  })
})

describe('ics', () => {
  it('expands recurring and single events', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test',
      'BEGIN:VEVENT', 'UID:weekly', 'SUMMARY:English', 'DTSTART:20260915T160000Z', 'DTEND:20260915T180000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=TU,FR;COUNT=4', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:once', 'SUMMARY:Dentist', 'DTSTART:20260916T090000Z', 'DTEND:20260916T093000Z', 'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const from = Date.UTC(2026, 8, 14)
    const to = Date.UTC(2026, 8, 30)
    const events = expandIcs(ics, from, to).sort((a, b) => a.start - b.start)
    expect(events.map((e) => e.title)).toEqual(['English', 'Dentist', 'English', 'English', 'English'])
    expect(events[0].end - events[0].start).toBe(2 * 3_600_000)
  })
})

describe('anilib', () => {
  it('reads the user id from a profile link', () => {
    expect(parseLibUserId('https://anilib.me/ru/user/1465271?page=1&sort_by=name')).toBe('1465271')
    expect(parseLibUserId(' 42 ')).toBe('42')
    expect(parseLibUserId('https://anilib.me/')).toBeNull()
  })

  it('maps a bookmark to a library item', () => {
    const anime = LIB_SITES[0]
    const bookmark = {
      status: 24,
      rating: 10,
      meta: { item_number: 12 },
      media: {
        id: 22791, name: 'Yuusha-kei', rus_name: 'Приговорённый быть героем', eng_name: 'Sentenced to Be a Hero',
        slug_url: '22791--yuusha', cover: { default: 'https://cover/x.jpg' }, type: { label: 'TV Сериал' }, items_count: 12,
        releaseDateString: '2026 г.', metadata: { last_item: { number: '11' } }
      }
    }
    expect(mapLibBookmark(bookmark, anime)).toMatchObject({
      kind: 'anime', externalId: '22791', title: 'Приговорённый быть героем', status: 'completed', progress: 12, total: 12,
      latest: 11, rating: 10, year: 2026, format: 'TV Сериал', url: 'https://anilib.me/ru/anime/22791--yuusha'
    })
    expect(mapLibBookmark({ ...bookmark, status: 25, meta: { item_number: 3 } }, anime)).toMatchObject({ status: 'active', favorite: true })
  })
})
