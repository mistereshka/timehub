import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../main/db'
import { mediaKind, primaryArtist } from './media'
import { Service } from './service'
import { DAY, MINUTE } from './time'

function setup() {
  const clock = { now: new Date(2026, 8, 15, 20, 0, 0).getTime() }
  const svc = new Service(openNodeDb(':memory:'), { now: () => clock.now, language: 'ru' })
  return { svc, clock }
}

describe('library', () => {
  it('moves through statuses as progress changes', () => {
    const { svc } = setup()
    const item = svc.saveLibraryItem({ kind: 'anime', title: 'Фрирен', total: 3 })
    expect(item).toMatchObject({ status: 'planned', progress: 0, statusAuto: true })
    expect(svc.bumpLibraryProgress(item.id).status).toBe('active')
    svc.bumpLibraryProgress(item.id)
    const done = svc.bumpLibraryProgress(item.id)
    expect(done).toMatchObject({ status: 'completed', progress: 3 })
    expect(done.finishedAt).not.toBeNull()
    expect(svc.bumpLibraryProgress(item.id).progress).toBe(3)
    expect(svc.saveLibraryItem({ id: item.id, kind: 'anime', title: 'Фрирен', rating: 14, favorite: true })).toMatchObject({
      rating: 10,
      favorite: true
    })
  })

  it('imports from a service and respects statuses changed by hand', () => {
    const { svc } = setup()
    const base = { kind: 'anime' as const, title: 'A', status: 'active' as const, progress: 2, total: 12, latest: 5 }
    expect(svc.importLibrary('anilib', [{ ...base, externalId: '1' }, { ...base, externalId: '2', title: 'B' }])).toEqual({
      added: 2,
      updated: 0,
      removed: 0
    })
    expect(svc.importLibrary('anilib', [{ ...base, externalId: '1' }, { ...base, externalId: '2', title: 'B' }]).updated).toBe(0)

    const b = svc.listLibrary().find((i) => i.title === 'B')!
    svc.saveLibraryItem({ id: b.id, kind: 'anime', title: 'B', status: 'dropped' })
    const result = svc.importLibrary('anilib', [
      { ...base, externalId: '1', progress: 3 },
      { ...base, externalId: '2', title: 'B', latest: 6 }
    ])
    expect(result.updated).toBe(2)
    expect(svc.listLibrary().find((i) => i.title === 'B')).toMatchObject({ status: 'dropped', latest: 6, statusAuto: false })
    expect(svc.listLibrary().find((i) => i.title === 'A')!.progress).toBe(3)

    expect(svc.importLibrary('anilib', [{ ...base, externalId: '1', progress: 3 }], { removeMissing: true }).removed).toBe(1)
    expect(svc.listLibrary({ kind: 'anime' })).toHaveLength(1)
  })

  it('follows games from the tracker', () => {
    const { svc, clock } = setup()
    const { app } = svc.ensureApp('D:\\SteamLibrary\\steamapps\\common\\Hades II\\Ship\\Hades2.exe', 'Hades2.exe', 'Hades II')
    svc.seedSession(app.id, 'Hades II', clock.now - 60 * MINUTE, clock.now)
    expect(svc.refreshGamesInLibrary()).toBe(1)
    const [game] = svc.listLibrary({ kind: 'game' })
    expect(game).toMatchObject({ title: 'Hades II', status: 'active', appId: app.id, trackedMs: 60 * MINUTE })
    clock.now += 31 * DAY
    svc.refreshGamesInLibrary()
    expect(svc.getLibraryItem(game.id)!.status).toBe('on_hold')
  })

  it('tells music from browser videos', () => {
    expect(mediaKind({ source: 'Spotify.exe', artist: 'Daft Punk', album: '' })).toBe('music')
    expect(mediaKind({ source: 'Chrome', artist: 'Some channel', album: '' })).toBe('video')
    expect(mediaKind({ source: 'Chrome', artist: 'Daft Punk', album: 'Discovery' })).toBe('music')
    expect(mediaKind({ source: 'MSEdge', artist: 'Daft Punk - Topic', album: '' })).toBe('music')
    expect(mediaKind({ source: 'Telegram.TelegramDesktop', artist: 'Friend', album: '' })).toBe('video')
  })

  it('finds the main artist of a track', () => {
    expect(primaryArtist('Сплин, Гость')).toBe('Сплин')
    expect(primaryArtist('Daft Punk feat. Pharrell Williams')).toBe('Daft Punk')
    expect(primaryArtist('Simon & Garfunkel')).toBe('Simon & Garfunkel')
  })

  it('groups the tracks of one album into it', () => {
    const { svc, clock } = setup()
    const t = clock.now - 60 * MINUTE
    svc.seedMedia('Chrome', 'Орбит без сахара', 'Сплин', 'Гранатовый альбом', t, t + 3 * MINUTE)
    svc.seedMedia('Chrome', 'Одиночка', 'Кто-то', 'Одиночка', t + 4 * MINUTE, t + 7 * MINUTE)
    expect(svc.refreshMusicInLibrary()).toBe(2)
    const orbit = svc.listLibrary({ kind: 'music' }).find((i) => i.title === 'Орбит без сахара')!
    svc.setLibraryCover(orbit.id, 'https://covers.example/orbit.jpg')
    svc.seedMedia('Chrome', 'Выхода нет', 'Сплин, Гость', 'Гранатовый альбом', t + 8 * MINUTE, t + 12 * MINUTE)
    // the album card comes in, the new track gets a card and both tracks sit inside the album
    expect(svc.refreshMusicInLibrary()).toBe(3)
    const shelf = svc.listLibrary({ kind: 'music' })
    const album = shelf.find((i) => i.title === 'Гранатовый альбом')!
    expect(shelf.filter((i) => i.parentId == null).map((i) => i.title).sort()).toEqual(['Гранатовый альбом', 'Одиночка'])
    expect(shelf.filter((i) => i.parentId === album.id).map((i) => i.title).sort()).toEqual(['Выхода нет', 'Орбит без сахара'])
    // the album takes the cover its track had
    expect(album).toMatchObject({ originalTitle: 'Сплин', format: 'Альбом · 2 трека', progress: 2, coverUrl: 'https://covers.example/orbit.jpg' })
    expect(svc.borrowAlbumCover('Сплин', 'Гранатовый альбом', 'https://covers.example/other.jpg')).toBe(false)
    // a track playing with a picture dresses an album that has none
    svc.setLibraryCover(album.id, '')
    expect(svc.borrowAlbumCover('Сплин, Гость', 'Гранатовый альбом', 'https://covers.example/2.jpg')).toBe(true)
    expect(svc.getLibraryItem(album.id)!.coverUrl).toBe('https://covers.example/2.jpg')
    expect(svc.getAlbumTracks(album.id).map((x) => x.title).sort()).toEqual(['Выхода нет', 'Орбит без сахара'])
    expect(svc.refreshMusicInLibrary()).toBe(0)
  })

  it('counts a track cut by pauses as one play and shelves the track right away', () => {
    const { svc, clock } = setup()
    const t = clock.now - 10 * MINUTE
    svc.seedMedia('Chrome', 'Выхода нет', 'Сплин', 'Гранатовый альбом', t, t + 6_000)
    svc.seedMedia('Chrome', 'Выхода нет', 'Сплин', 'Гранатовый альбом', t + 20_000, t + 72_000)
    svc.seedMedia('Chrome', 'Выхода нет', 'Сплин', 'Гранатовый альбом', t + 115_000, t + 125_000)
    const music = svc.getMusic(t - MINUTE, clock.now)
    expect(music.plays).toBe(1)
    expect(music.topTracks[0]).toMatchObject({ title: 'Выхода нет', plays: 1, ms: 68_000 })
    expect(svc.refreshMusicInLibrary()).toBe(1)
    expect(svc.listLibrary({ kind: 'music' })[0]).toMatchObject({
      title: 'Выхода нет',
      originalTitle: 'Сплин',
      format: 'Гранатовый альбом',
      progress: 1,
      status: 'active'
    })
  })

  it('turns a browser track into music when the album arrives a moment later', () => {
    const { svc, clock } = setup()
    const base = { source: 'Chrome', title: 'Группа крови', artist: 'Кино', playing: true }
    svc.recordMedia({ ...base, at: clock.now, album: '', kind: 'video' }, 10_000)
    svc.recordMedia({ ...base, at: clock.now + 10_000, album: 'Группа крови', kind: 'music' }, 10_000)
    svc.recordMedia({ ...base, at: clock.now + 20_000, album: 'Группа крови', kind: 'music' }, 10_000)
    svc.closeMedia(clock.now + 30_000)
    const music = svc.getMusic(clock.now - MINUTE, clock.now + MINUTE)
    expect(music.plays).toBe(1)
    // the session ends at the last sample, like every other span
    expect(music.totalMs).toBe(20_000)
  })

  it('keeps videos out of music and turns listening into library items', () => {
    const { svc, clock } = setup()
    const start = clock.now - 3 * 60 * MINUTE
    for (let i = 0; i < 3; i++) {
      svc.seedMedia('Spotify.exe', `Track ${i}`, 'Daft Punk', 'Discovery', start + i * 5 * MINUTE, start + (i * 5 + 4) * MINUTE)
    }
    svc.seedMedia('Chrome', 'Funny short #shorts', 'Channel', '', start, start + 20_000, 'video')
    const music = svc.getMusic(start - MINUTE, clock.now)
    expect(music.plays).toBe(3)
    expect(music.topArtists.map((a) => a.name)).toEqual(['Daft Punk'])

    expect(svc.refreshMusicInLibrary()).toBe(4)
    const shelf = svc.listLibrary({ kind: 'music' })
    const album = shelf.find((i) => i.parentId == null)!
    expect(shelf.filter((i) => i.parentId === album.id)).toHaveLength(3)
    expect(album).toMatchObject({
      title: 'Discovery', originalTitle: 'Daft Punk', format: 'Альбом · 3 трека', status: 'active', progress: 3, source: 'tracker'
    })
    expect(svc.refreshMusicInLibrary()).toBe(0)
    clock.now += 31 * DAY
    svc.refreshMusicInLibrary()
    expect(svc.getLibraryItem(album.id)!.status).toBe('on_hold')
  })

  it('forgets its own app together with the history', () => {
    const { svc, clock } = setup()
    const { app } = svc.ensureApp('C:\\Apps\\timehub\\timehub.exe', 'timehub.exe', 'timehub')
    svc.seedSession(app.id, 'timehub', clock.now - 10 * MINUTE, clock.now)
    expect(svc.forgetApps({ names: ['timehub.exe'] })).toBe(1)
    expect(svc.listApps().some((a) => a.id === app.id)).toBe(false)
    expect(svc.getUsage(0, clock.now + 1).activeMs).toBe(0)
  })
})
