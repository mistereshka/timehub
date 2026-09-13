import { HOST_METHODS, SERVICE_METHODS, type HostHandlers, type TimehubApi } from '@shared/api'
import { Service } from '@shared/service'
import { transaction } from '@shared/sql'
import { MINUTE, todayKey } from '@shared/time'
import type { ChangeTopic, Lang, TrackerStatus } from '@shared/types'
import { version } from '../../../../package.json'
import { DEMO_ACTIVITY, seedDemo } from './seed'
import { openSqlJsDb } from './sqljs'

const POLL_MS = 5000

/**
 * Runs the real Service against an in-memory SQLite (WebAssembly) so the UI
 * works in a normal browser — used for screenshots and trying the app out.
 */
export async function createDemoApi(): Promise<TimehubApi> {
  const db = await openSqlJsDb()
  const listeners = new Set<(topic: ChangeTopic) => void>()
  const pending = new Set<ChangeTopic>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const emit = (topic: ChangeTopic): void => {
    pending.add(topic)
    flushTimer ??= setTimeout(() => {
      flushTimer = null
      const topics = [...pending]
      pending.clear()
      for (const t of topics) for (const listener of listeners) listener(t)
    }, 50)
  }

  // ?lang=ru|en and ?theme=light|dark|dark_dimmed make screenshots reproducible.
  const params = new URLSearchParams(window.location.search)
  const langParam = params.get('lang')
  const language: Lang =
    langParam === 'ru' || langParam === 'en' ? langParam : navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'

  let fakeNow: number | null = null
  const service = new Service(db, { language, now: () => fakeNow ?? Date.now(), onChange: emit })
  transaction(db, () => seedDemo(service, language, (t) => (fakeNow = t)))
  service.generateRecurring()
  const theme = params.get('theme')
  if (theme === 'light' || theme === 'dark' || theme === 'dark_dimmed') service.updateSettings({ theme })

  // A pretend tracker so today's schedule keeps growing while you look around.
  let status: TrackerStatus = { supported: true, state: 'active', current: null, games: [] }
  const tick = (): void => {
    if (service.getSettings().trackingPaused) {
      service.closeActivity(Date.now())
      status = { ...status, state: 'paused', current: null }
    } else {
      const r = service.recordSample({ at: Date.now(), ...DEMO_ACTIVITY, idleMs: 0 }, { intervalMs: POLL_MS, idleThresholdMs: 5 * MINUTE })
      if (r.state === 'active') {
        status = {
          ...status,
          state: 'active',
          current: { appId: r.app.id, displayName: r.app.displayName, icon: r.app.icon, title: r.title, since: r.since }
        }
      }
    }
    emit('tracker')
  }
  tick()
  setInterval(tick, POLL_MS)

  const host: HostHandlers = {
    getMeta: () => ({ version, dataPath: 'in-memory', demo: true, platform: 'web', packaged: false }),
    getTrackerStatus: () => status,
    exportData: (format) => {
      const name = `timehub-demo-${todayKey()}.${format}`
      const blob = new Blob([format === 'json' ? service.exportJson() : service.exportCsv()], {
        type: format === 'json' ? 'application/json' : 'text/csv'
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      return name
    },
    openDataFolder: () => {},
    setTitleBarTheme: () => {},
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener')
    }
  }

  const api: Record<string, unknown> = {}
  for (const m of SERVICE_METHODS) {
    const fn = service[m] as (...args: unknown[]) => unknown
    api[m] = async (...args: unknown[]) => fn.apply(service, args)
  }
  for (const m of HOST_METHODS) {
    const fn = host[m] as (...args: unknown[]) => unknown
    api[m] = async (...args: unknown[]) => fn(...args)
  }
  api.onChange = (listener: (topic: ChangeTopic) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return api as unknown as TimehubApi
}
