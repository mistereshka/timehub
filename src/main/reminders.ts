import { Notification } from 'electron'
import type { Service } from '@shared/service'
import { dueReminders, type Reminder } from '@shared/reminders'
import { DAY, MINUTE, addDays, formatHM, todayKey } from '@shared/time'

function minutesText(min: number, ru: boolean): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (ru) return [h ? `${h} ч` : '', m ? `${m} мин` : ''].filter(Boolean).join(' ')
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')
}

/** Windows notifications before timed tasks (goal practice included) and calendar events. */
export class Reminders {
  private readonly sent = new Set<string>()
  // Keep shown notifications alive — a garbage-collected one loses its click handler.
  private readonly shown: Notification[] = []

  constructor(
    private readonly service: Service,
    private readonly icon: string,
    private readonly open: (path: string) => void
  ) {}

  tick(now = Date.now()): void {
    const settings = this.service.getSettings()
    if (!settings.reminders || !Notification.isSupported()) return
    const today = todayKey(now)
    const tomorrow = addDays(today, 1) // a lead can reach past midnight
    const tasks = this.service.listTasks({ status: 'open' }).filter((t) => t.plannedDate === today || t.plannedDate === tomorrow)
    const events = this.service.listCalendarEvents(now - DAY, now + DAY)
    for (const r of dueReminders(tasks, events, now, Math.max(0, settings.remindBeforeMin) * MINUTE)) {
      if (this.sent.has(r.key)) continue
      this.sent.add(r.key)
      this.show(r, now, settings.language === 'ru')
    }
  }

  /** Sends a sample so you can check that Windows shows timehub's notifications. */
  test(): boolean {
    if (!Notification.isSupported()) return false
    const ru = this.service.getSettings().language === 'ru'
    this.notify('timehub', ru ? 'Так будут выглядеть напоминания о задачах и занятиях' : 'This is how task and practice reminders look', '/settings')
    return true
  }

  private show(r: Reminder, now: number, ru: boolean): void {
    const left = Math.round((r.start - now) / MINUTE)
    const when =
      left > 0
        ? ru
          ? `Через ${left} мин · в ${formatHM(r.start)}`
          : `In ${left} min · at ${formatHM(r.start)}`
        : ru
          ? `Пора начинать · ${formatHM(r.start)}`
          : `Time to start · ${formatHM(r.start)}`
    const details = [r.estimateMin ? minutesText(r.estimateMin, ru) : '', r.location].filter(Boolean)
    this.notify(r.title, [when, ...details].join(' · '), r.path)
  }

  private notify(title: string, body: string, path: string): void {
    const n = new Notification({ title, body, icon: this.icon })
    n.on('click', () => this.open(path))
    n.on('close', () => this.shown.splice(this.shown.indexOf(n), 1))
    this.shown.push(n)
    if (this.shown.length > 20) this.shown.shift()
    n.show()
  }
}
