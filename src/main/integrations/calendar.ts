import ICAL from 'ical.js'
import type { CalendarEvent, CalendarSourceConfig } from '@shared/types'
import { DAY, HOUR } from '@shared/time'
import type { Connector, Env } from './connections'
import { getText } from './http'

type ParsedEvent = Omit<CalendarEvent, 'id' | 'source' | 'color'>

/** Expands an iCalendar feed into concrete events within [from, to), recurring ones included. */
export function expandIcs(text: string, from: number, to: number): ParsedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  const out: ParsedEvent[] = []
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(vevent)
    if (!ev.startDate) continue
    const allDay = ev.startDate.isDate
    const base = { title: ev.summary || '—', location: ev.location || '', allDay }
    if (ev.isRecurring()) {
      const it = ev.iterator()
      for (let guard = 0; guard < 2000; guard++) {
        const next = it.next()
        if (!next) break
        const occ = ev.getOccurrenceDetails(next)
        const start = occ.startDate.toJSDate().getTime()
        if (start >= to) break
        const end = occ.endDate.toJSDate().getTime()
        if (end > from) out.push({ ...base, title: occ.item.summary || base.title, uid: `${ev.uid}#${start}`, start, end })
      }
    } else if (!vevent.getFirstPropertyValue('recurrence-id')) {
      const start = ev.startDate.toJSDate().getTime()
      const end = ev.endDate ? ev.endDate.toJSDate().getTime() : start + (allDay ? DAY : HOUR)
      if (end > from && start < to) out.push({ ...base, uid: ev.uid || `${start}`, start, end })
    }
  }
  return out
}

export function parseSources(raw: string | undefined): CalendarSourceConfig[] {
  try {
    const list = JSON.parse(raw || '[]') as CalendarSourceConfig[]
    return Array.isArray(list) ? list.filter((s) => s && s.id && s.url) : []
  } catch {
    return []
  }
}

/** Calendars by iCal link (Google, Outlook, Yandex, Apple): events show up in Today, Plan and Schedule. */
export class CalendarConnector implements Connector {
  readonly key = 'calendar' as const
  readonly defaultEnabled = false
  readonly syncEveryMs = 30 * 60_000
  private known = new Set<string>()

  async sync(env: Env): Promise<void> {
    const sources = parseSources(env.settings().sources)
    const ru = env.language() === 'ru'
    const now = Date.now()
    const from = now - 14 * DAY
    const to = now + 90 * DAY
    let total = 0
    const errors: string[] = []
    for (const s of sources) {
      try {
        const text = await getText(s.url.replace(/^webcal:/i, 'https:'))
        const events = expandIcs(text, from, to).map((e) => ({ ...e, color: s.color || '#0969da' }))
        env.service.replaceCalendarEvents(s.id, from, to, events)
        total += events.length
      } catch (err) {
        errors.push(`${s.name}: ${(err as Error).message}`)
      }
    }
    const ids = new Set(sources.map((s) => s.id))
    for (const id of this.known) if (!ids.has(id)) env.service.deleteCalendarSource(id)
    this.known = ids
    env.setState({
      connected: sources.length > 0,
      detail: sources.length ? (ru ? `${sources.length} календ. · ${total} событий` : `${sources.length} calendars · ${total} events`) : null
    })
    if (errors.length) throw new Error(errors.join('; '))
  }
}
