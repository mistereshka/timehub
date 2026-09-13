import { describe, expect, it } from 'vitest'
import { buildHeatmap, levelScale } from './heatmap'

describe('contribution heatmap', () => {
  it('assigns levels by quartile of non-zero days', () => {
    const scale = levelScale([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect([0, 1, 4, 6, 8].map(scale)).toEqual([0, 1, 2, 3, 4])
  })

  it('builds 53 Sunday-start weeks ending today, with streaks', () => {
    const values = [
      { date: '2026-09-01', value: 2 },
      { date: '2026-09-11', value: 5 },
      { date: '2026-09-12', value: 3 },
      { date: '2026-09-13', value: 1 }
    ]
    const h = buildHeatmap(values, '2026-09-13', 0)
    expect(h.weeks).toHaveLength(53)
    expect(h.weeks[52][0]?.date).toBe('2026-09-13')
    expect(h.weeks[52][1]).toBeNull()
    expect(h).toMatchObject({ total: 11, activeDays: 4, currentStreak: 3, longestStreak: 3 })
  })

  it('supports Monday-start weeks', () => {
    const h = buildHeatmap([], '2026-09-13', 1)
    expect(h.weeks[52][0]?.date).toBe('2026-09-07')
    expect(h.weeks[52][6]?.date).toBe('2026-09-13')
    expect(h.months.length).toBeGreaterThanOrEqual(12)
  })
})
