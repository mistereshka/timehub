import type { Lang } from './types'

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Local calendar day as yyyy-mm-dd. String comparison orders keys chronologically. */
export function dayKey(d: Date | number): string {
  const x = typeof d === 'number' ? new Date(d) : d
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const todayKey = (now: number = Date.now()): string => dayKey(now)

export function addDays(key: string, n: number): string {
  const d = parseDayKey(key)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

/** Local midnight at the start of the day. */
export const startOfDayMs = (key: string): number => parseDayKey(key).getTime()
/** Local midnight at the end of the day (start of the next day). */
export const endOfDayMs = (key: string): number => startOfDayMs(addDays(key, 1))

/** 0 = Monday … 6 = Sunday */
export const weekday = (key: string): number => (parseDayKey(key).getDay() + 6) % 7

export function startOfWeek(key: string, weekStartsOn: 0 | 1): string {
  const offset = (parseDayKey(key).getDay() - weekStartsOn + 7) % 7
  return addDays(key, -offset)
}

/** Whole calendar days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const ua = Date.UTC(...(a.split('-').map(Number) as [number, number, number]))
  const ub = Date.UTC(...(b.split('-').map(Number) as [number, number, number]))
  return Math.round((ub - ua) / DAY)
}

/** Length of [start, end) that falls within [from, to). */
export const clipDuration = (start: number, end: number, from: number, to: number): number =>
  Math.max(0, Math.min(end, to) - Math.max(start, from))

/** Compact duration: "2h 15m", "45m", "<1m" (ru: "2ч 15м"). */
export function formatDuration(ms: number, lang: Lang, withSeconds = false): string {
  const u = lang === 'ru' ? { h: 'ч', m: 'м', s: 'с' } : { h: 'h', m: 'm', s: 's' }
  const total = Math.floor(Math.max(0, ms) / SECOND)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? `${h}${u.h} ${m}${u.m}` : `${h}${u.h}`
  if (m > 0) return withSeconds && s > 0 ? `${m}${u.m} ${s}${u.s}` : `${m}${u.m}`
  if (withSeconds) return `${s}${u.s}`
  return total > 0 ? `<1${u.m}` : `0${u.m}`
}

/** Stopwatch format: 1:05:09 or 5:09 */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / SECOND)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

/** Local HH:MM */
export function formatHM(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
