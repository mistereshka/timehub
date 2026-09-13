import type { Category, LibraryKind, LibraryStatus, Recurrence, Task } from '@shared/types'
import { addDays, todayKey } from '@shared/time'
import type { I18n, MessageKey } from './i18n'

/** A known Monday, used to get localized weekday names. */
const REFERENCE_MONDAY = '2026-09-07'

export function categoryName(c: Category | undefined, t: I18n['t']): string {
  if (!c) return '—'
  return c.key ? t(`category.${c.key}` as MessageKey) : c.name
}

/** "Today" / "Tomorrow" / "Yesterday" or a formatted date. */
export function dayLabel(key: string, i18n: I18n, pattern = 'EEE, d MMM'): string {
  const today = todayKey()
  if (key === today) return i18n.t('date.today')
  if (key === addDays(today, 1)) return i18n.t('date.tomorrow')
  if (key === addDays(today, -1)) return i18n.t('date.yesterday')
  return i18n.date(key, pattern)
}

/** 0 = Monday … 6 = Sunday */
export const weekdayName = (index: number, i18n: I18n, pattern = 'EEEEEE'): string =>
  i18n.date(addDays(REFERENCE_MONDAY, index), pattern)

export const percent = (share: number): string => `${(share * 100).toFixed(share >= 0.1 || share === 0 ? 0 : 1)}%`

export function ruleText(rec: Pick<Recurrence, 'rule' | 'daysMask' | 'dayOfMonth'>, i18n: I18n): string {
  switch (rec.rule) {
    case 'daily':
      return i18n.t('rule.daily')
    case 'weekdays':
      return i18n.t('rule.weekdays')
    case 'weekly': {
      const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => rec.daysMask & (1 << i)).map((i) => weekdayName(i, i18n, 'EEEEEE'))
      return i18n.t('rule.weeklyOn', { days: days.join(', ') })
    }
    case 'monthly':
      return i18n.t('rule.monthlyOn', { day: rec.dayOfMonth ?? 1 })
  }
}

/** Completion percent to show, or null when the task has no progress to speak of. */
export function taskProgress(task: Pick<Task, 'status' | 'progress' | 'childCount' | 'childDone'>): number | null {
  if (task.status === 'closed') return 100
  if (task.progress != null) return task.progress
  if (task.childCount > 0) return Math.round((task.childDone / task.childCount) * 100)
  return null
}

type Verb = 'watch' | 'read' | 'play' | 'listen'
export const libraryVerb = (kind: LibraryKind): Verb =>
  kind === 'manga' || kind === 'book' ? 'read' : kind === 'game' ? 'play' : kind === 'music' ? 'listen' : 'watch'

/** "Смотрю" / "Читаю" / "Играю" depending on what the item is. */
export function libraryStatusLabel(status: LibraryStatus, kind: LibraryKind | null, t: I18n['t']): string {
  const verb = kind ? libraryVerb(kind) : 'watch'
  switch (status) {
    case 'active':
      return kind ? t(`lib.st.active.${verb}` as MessageKey) : t('lib.st.active.any')
    case 'completed':
      return kind ? t(`lib.st.completed.${verb}` as MessageKey) : t('lib.st.completed.any')
    case 'rewatching':
      return kind ? t(`lib.st.rewatching.${verb}` as MessageKey) : t('lib.st.rewatching.any')
    default:
      return t(`lib.st.${status}` as MessageKey)
  }
}

/** Unit for progress numbers: episodes, chapters, pages, hours, plays. RanobeLib counts chapters, not pages. */
export const libraryUnit = (kind: LibraryKind, t: I18n['t'], source?: string): string =>
  t(source === 'ranobelib' ? 'lib.unit.manga' : (`lib.unit.${kind}` as MessageKey))

export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

/** "HH:MM" from a timestamp, for <input type="time"> */
export function timeInputValue(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Combines a yyyy-mm-dd key and "HH:MM" into a local timestamp. */
export function combineDateTime(day: string, time: string): number {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime()
}
