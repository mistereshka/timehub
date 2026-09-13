import { describe, expect, it } from 'vitest'
import { buildAgenda } from './schedule'
import type { ActivitySession } from './types'

const base = new Date(2026, 8, 14, 10, 0, 0).getTime()
const S = (appId: number, startSec: number, endSec: number, title = '', categoryId = 1): ActivitySession => ({
  id: 0, appId, title, start: base + startSec * 1000, end: base + endSec * 1000, taskId: null, categoryId
})
const spans = (blocks: ReturnType<typeof buildAgenda>): number[][] =>
  blocks.map((b) => [b.appId, (b.start - base) / 1000, (b.end - base) / 1000])

describe('day agenda', () => {
  it('merges same-app stretches across brief alt-tabs', () => {
    const sessions = [S(1, 0, 600, 'a.ts'), S(2, 600, 610), S(1, 610, 1200, 'b.ts'), S(3, 1200, 1500, 'YouTube'), S(1, 1500, 1520)]
    const blocks = buildAgenda(sessions, { from: base, to: base + 3_600_000 })
    expect(spans(blocks)).toEqual([[1, 0, 1200], [3, 1200, 1500]])
    expect(blocks[0].activeMs).toBe(1_190_000)
    expect(blocks[0].titles[0]).toEqual({ title: 'a.ts', ms: 600_000 })
  })

  it('clips to the day and drops tiny blocks', () => {
    // App 2 (60 s) is long enough to split the stretch, but both short blocks are dropped.
    const sessions = [S(1, -600, 300), S(2, 300, 360), S(1, 360, 400)]
    expect(spans(buildAgenda(sessions, { from: base, to: base + 3_600_000 }))).toEqual([[1, 0, 300]])
  })

  it('keeps rule-recategorized stretches of the same app apart', () => {
    const sessions = [S(1, 0, 600, 'Docs', 1), S(1, 600, 1200, 'YouTube', 5)]
    expect(buildAgenda(sessions, { from: base, to: base + 3_600_000 })).toHaveLength(2)
  })
})
