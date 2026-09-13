import { describe, expect, it } from 'vitest'
import { computeStreak, occurrencesBetween, occursOn } from './recurrence'

const base = { daysMask: 0, dayOfMonth: null, startDate: '2026-01-01' }

describe('recurrence rules', () => {
  it('handles weekdays and specific weekdays', () => {
    expect(occursOn({ ...base, rule: 'weekdays' }, '2026-09-11')).toBe(true) // Friday
    expect(occursOn({ ...base, rule: 'weekdays' }, '2026-09-12')).toBe(false) // Saturday
    const monWedFri = { ...base, rule: 'weekly' as const, daysMask: 0b0010101 }
    expect(occurrencesBetween(monWedFri, '2026-09-07', '2026-09-13')).toEqual(['2026-09-07', '2026-09-09', '2026-09-11'])
  })

  it('clamps monthly rules to the last day of short months', () => {
    const rec = { ...base, rule: 'monthly' as const, dayOfMonth: 31 }
    expect(occurrencesBetween(rec, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('never occurs before the start date', () => {
    expect(occursOn({ ...base, rule: 'daily', startDate: '2026-09-10' }, '2026-09-09')).toBe(false)
  })

  it('counts a streak back from today, tolerating an unfinished today', () => {
    const rec = { ...base, rule: 'daily' as const }
    const done = new Set(['2026-09-10', '2026-09-11', '2026-09-12'])
    expect(computeStreak(rec, done, '2026-09-13')).toBe(3)
    done.add('2026-09-13')
    expect(computeStreak(rec, done, '2026-09-13')).toBe(4)
    done.delete('2026-09-11')
    expect(computeStreak(rec, done, '2026-09-13')).toBe(2)
  })

  it('keeps a weekday streak across the weekend', () => {
    const rec = { ...base, rule: 'weekdays' as const }
    expect(computeStreak(rec, new Set(['2026-09-10', '2026-09-11', '2026-09-14']), '2026-09-14')).toBe(3)
  })
})
