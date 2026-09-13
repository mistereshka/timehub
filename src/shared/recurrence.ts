import type { Recurrence } from './types'
import { addDays, parseDayKey, weekday } from './time'

export const WEEKDAYS_MASK = 0b0011111

type RuleFields = Pick<Recurrence, 'rule' | 'daysMask' | 'dayOfMonth' | 'startDate'>

export function occursOn(rec: RuleFields, key: string): boolean {
  if (key < rec.startDate) return false
  switch (rec.rule) {
    case 'daily':
      return true
    case 'weekdays':
      return weekday(key) < 5
    case 'weekly':
      return (rec.daysMask & (1 << weekday(key))) !== 0
    case 'monthly': {
      const d = parseDayKey(key)
      const wanted = rec.dayOfMonth ?? parseDayKey(rec.startDate).getDate()
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      return d.getDate() === Math.min(wanted, lastDay)
    }
  }
}

/**
 * Consecutive completed occurrences, counting back from today. Today's
 * occurrence only counts once done — an unfinished today doesn't break it.
 */
export function computeStreak(rec: RuleFields, doneDates: ReadonlySet<string>, today: string): number {
  let key = today
  if (occursOn(rec, key) && !doneDates.has(key)) key = addDays(key, -1)
  let streak = 0
  for (let i = 0; i < 3700 && key >= rec.startDate; i++) {
    if (occursOn(rec, key)) {
      if (!doneDates.has(key)) break
      streak++
    }
    key = addDays(key, -1)
  }
  return streak
}

/** Occurrence days in [fromKey, toKey]. */
export function occurrencesBetween(rec: RuleFields, fromKey: string, toKey: string): string[] {
  const out: string[] = []
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    if (occursOn(rec, key)) out.push(key)
  }
  return out
}
