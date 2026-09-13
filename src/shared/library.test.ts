import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../main/db'
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
})
