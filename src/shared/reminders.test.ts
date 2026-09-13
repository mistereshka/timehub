import { describe, expect, it } from 'vitest'
import type { CalendarEvent, Task } from './types'
import { dueReminders } from './reminders'
import { HOUR, MINUTE, startOfDayMs } from './time'

const day = '2026-09-15'
const at = (h: number, m = 0): number => startOfDayMs(day) + h * HOUR + m * MINUTE
const task = (patch: Partial<Task> = {}): Task =>
  ({ id: 1, number: 7, title: 'English', status: 'open', plannedDate: day, plannedTime: '19:00', estimateMin: 120, ...patch }) as Task
const event = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 1, source: 'work', uid: 'standup', title: 'Standup', location: 'Meet', start: at(10), end: at(10, 15), allDay: false, color: '#0969da', ...patch
})

describe('reminders', () => {
  it('fires a few minutes before a timed task and only once in the window', () => {
    const lead = 5 * MINUTE
    expect(dueReminders([task()], [], at(18, 54), lead)).toHaveLength(0)
    expect(dueReminders([task()], [], at(18, 55), lead)).toEqual([
      { key: `task:1:${day}`, title: 'English', start: at(19), path: '/tasks/7', location: '', estimateMin: 120 }
    ])
    expect(dueReminders([task()], [], at(18, 58), lead)).toHaveLength(0)
  })

  it('skips closed tasks, tasks without a time and all-day events', () => {
    expect(dueReminders([task({ status: 'closed' }), task({ plannedTime: null })], [event({ allDay: true })], at(19), 0)).toHaveLength(0)
  })

  it('reminds about calendar events', () => {
    const [r] = dueReminders([], [event()], at(10), 0)
    expect(r).toMatchObject({ title: 'Standup', path: '/today', location: 'Meet' })
  })
})
