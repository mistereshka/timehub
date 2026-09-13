import type { CalendarEvent, Task } from './types'
import { HOUR, MINUTE, startOfDayMs } from './time'

export interface Reminder {
  /** Stable id so a reminder is shown once */
  key: string
  title: string
  /** When the task or event starts */
  start: number
  /** Where a click on the notification leads, e.g. /tasks/12 */
  path: string
  location: string
  estimateMin: number | null
}

/** How late a reminder may still fire: the app checks every 30 s and may have been asleep. */
export const REMINDER_WINDOW_MS = 2 * MINUTE

function startOf(date: string, time: string): number {
  const [h, m] = time.split(':').map(Number)
  return startOfDayMs(date) + h * HOUR + m * MINUTE
}

/**
 * Timed tasks (goal practice included — it is a recurring task) and calendar
 * events whose reminder time, `start − lead`, has just come.
 */
export function dueReminders(tasks: Task[], events: CalendarEvent[], now: number, leadMs: number): Reminder[] {
  const due = (start: number): boolean => {
    const at = start - leadMs
    return now >= at && now - at <= REMINDER_WINDOW_MS
  }
  const out: Reminder[] = []
  for (const t of tasks) {
    if (t.status !== 'open' || !t.plannedDate || !t.plannedTime) continue
    const start = startOf(t.plannedDate, t.plannedTime)
    if (!due(start)) continue
    out.push({ key: `task:${t.id}:${t.plannedDate}`, title: t.title, start, path: `/tasks/${t.number}`, location: '', estimateMin: t.estimateMin })
  }
  for (const e of events) {
    if (e.allDay || !due(e.start)) continue
    out.push({ key: `event:${e.source}:${e.uid}:${e.start}`, title: e.title, start: e.start, path: '/today', location: e.location, estimateMin: null })
  }
  return out
}
