import { describe, expect, it } from 'vitest'
import { parseVdf, vdfGet } from './vdf'
import { parseRobloxLog } from './roblox'
import { expandIcs } from './calendar'
import { LIB_SITES, mapLibBookmark, parseLibUserId } from './anilib'

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
