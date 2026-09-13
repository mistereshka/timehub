import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, formatClock, formatDuration, startOfWeek, weekday } from './time'

describe('time helpers', () => {
  it('formats durations compactly in both languages', () => {
    expect(formatDuration(0, 'en')).toBe('0m')
    expect(formatDuration(20_000, 'en')).toBe('<1m')
    expect(formatDuration(45 * 60_000, 'ru')).toBe('45м')
    expect(formatDuration(2 * 3_600_000 + 15 * 60_000, 'ru')).toBe('2ч 15м')
    expect(formatDuration(3 * 3_600_000, 'en')).toBe('3h')
    expect(formatDuration(65_000, 'en', true)).toBe('1m 5s')
  })

  it('does calendar math on local day keys', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-09-01', '2026-09-13')).toBe(12)
    expect(weekday('2026-09-13')).toBe(6) // Sunday
    expect(startOfWeek('2026-09-13', 1)).toBe('2026-09-07')
    expect(startOfWeek('2026-09-13', 0)).toBe('2026-09-13')
  })

  it('formats a stopwatch', () => {
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })
})
