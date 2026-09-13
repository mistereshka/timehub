import { addDays } from './time'

/** Consecutive days present in `days`, counting back from today (today may still be empty). */
export function currentStreak(days: ReadonlySet<string>, today: string): number {
  let key = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(key)) {
    n++
    key = addDays(key, -1)
  }
  return n
}

/** Longest run of consecutive days. */
export function longestStreak(days: Iterable<string>): number {
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const day of [...new Set(days)].sort()) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1
    best = Math.max(best, run)
    prev = day
  }
  return best
}
