import { describe, expect, it } from 'vitest'
import { groupShortBlocks, type AgendaBlock } from './schedule'
import { MINUTE } from './time'

const block = (appId: number, fromMin: number, toMin: number): AgendaBlock => ({
  appId,
  categoryId: appId,
  start: fromMin * MINUTE,
  end: toMin * MINUTE,
  activeMs: (toMin - fromMin) * MINUTE,
  titles: [{ title: `window ${appId}`, ms: (toMin - fromMin) * MINUTE }]
})

describe('day timeline', () => {
  it('groups quick app switches into readable blocks and keeps long ones', () => {
    const out = groupShortBlocks(
      [block(1, 0, 60), block(2, 60, 62), block(3, 62, 63), block(2, 63, 70), block(4, 70, 75), block(2, 75, 90), block(1, 90, 150)],
      20 * MINUTE
    )
    expect(out.map((b) => [b.start / MINUTE, b.end / MINUTE])).toEqual([
      [0, 60],
      [60, 90],
      [90, 150]
    ])
    expect(out[1]).toMatchObject({ appId: 2, activeMs: 30 * MINUTE, titles: [] })
    expect(out[1].apps.map((a) => a.appId)).toEqual([2, 4, 3])
    expect(out[0]).toMatchObject({ appId: 1, apps: [{ appId: 1, ms: 60 * MINUTE }], titles: [{ title: 'window 1', ms: 60 * MINUTE }] })
  })

  it('joins neighbours led by the same app and swallows a leftover short piece', () => {
    const out = groupShortBlocks([block(1, 0, 30), block(1, 35, 65), block(2, 65, 66), block(1, 66, 90), block(3, 90, 130)], 20 * MINUTE)
    expect(out.map((b) => [b.start / MINUTE, b.end / MINUTE, b.appId])).toEqual([
      [0, 90, 1],
      [90, 130, 3]
    ])
    expect(out[0].apps).toEqual([
      { appId: 1, categoryId: 1, ms: 84 * MINUTE },
      { appId: 2, categoryId: 2, ms: MINUTE }
    ])
  })

  it('does not glue switches across a pause', () => {
    const out = groupShortBlocks([block(2, 200, 201), block(3, 210, 211)], 20 * MINUTE)
    expect(out).toHaveLength(2)
    expect(out.map((b) => b.apps.length)).toEqual([1, 1])
  })
})
