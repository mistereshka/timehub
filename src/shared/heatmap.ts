import type { DayValue } from './types'
import { addDays, parseDayKey, startOfWeek } from './time'

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export interface HeatCell {
  date: string
  value: number
  level: HeatLevel
}

export interface Heatmap {
  /** Columns of 7 days; days after the end date are null */
  weeks: (HeatCell | null)[][]
  /** Column index where each month starts */
  months: { col: number; month: number; year: number }[]
  total: number
  activeDays: number
  longestStreak: number
  currentStreak: number
}

/** Quartiles of the non-zero values, like GitHub's contribution graph. */
export function levelScale(values: number[]): (v: number) => HeatLevel {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (nz.length === 0) return () => 0
  const q = (p: number): number => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))]
  const [t1, t2, t3] = [q(0.25), q(0.5), q(0.75)]
  return (v) => (v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4)
}

export function buildHeatmap(values: DayValue[], endKey: string, weekStartsOn: 0 | 1, weekCount = 53): Heatmap {
  const byDay = new Map(values.map((v) => [v.date, v.value]))
  const firstKey = addDays(startOfWeek(endKey, weekStartsOn), -(weekCount - 1) * 7)
  const inRange = [...byDay].filter(([k]) => k >= firstKey && k <= endKey).map(([, v]) => v)
  const scale = levelScale(inRange)

  const weeks: (HeatCell | null)[][] = []
  const months: Heatmap['months'] = []
  let total = 0
  let activeDays = 0
  let run = 0
  let longestStreak = 0
  for (let w = 0; w < weekCount; w++) {
    const column: (HeatCell | null)[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(firstKey, w * 7 + d)
      if (date > endKey) {
        column.push(null)
        continue
      }
      const value = byDay.get(date) ?? 0
      column.push({ date, value, level: scale(value) })
      total += value
      if (value > 0) {
        activeDays++
        run++
        longestStreak = Math.max(longestStreak, run)
      } else {
        run = 0
      }
    }
    weeks.push(column)
    const first = parseDayKey(addDays(firstKey, w * 7))
    const prev = months[months.length - 1]
    if (!prev || prev.month !== first.getMonth()) {
      months.push({ col: w, month: first.getMonth(), year: first.getFullYear() })
    }
  }

  let currentStreak = 0
  let key = (byDay.get(endKey) ?? 0) > 0 ? endKey : addDays(endKey, -1)
  while ((byDay.get(key) ?? 0) > 0) {
    currentStreak++
    key = addDays(key, -1)
  }

  return { weeks, months, total, activeDays, longestStreak, currentStreak }
}
