import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../main/db'
import { Service } from './service'
import { DAY, HOUR, MINUTE, dayKey } from './time'

const opts = { intervalMs: 5000, idleThresholdMs: 5 * MINUTE }

function setup() {
  const clock = { now: new Date(2026, 8, 14, 9, 0, 0).getTime() } // Monday 09:00
  const svc = new Service(openNodeDb(':memory:'), { now: () => clock.now, language: 'ru' })
  const sample = (exe: string, title: string, idleMs = 0) =>
    svc.recordSample({ at: clock.now, exePath: `C:\\Apps\\${exe}`, exeName: exe, title, idleMs }, opts)
  return { svc, clock, sample }
}

describe('Service: setup and tasks', () => {
  it('seeds categories, labels and settings in the chosen language', () => {
    const { svc } = setup()
    expect(svc.listCategories().map((c) => c.key)).toContain('games')
    expect(svc.listLabels().map((l) => l.name)).toContain('работа')
    expect(svc.getSettings()).toMatchObject({ language: 'ru', weekStartsOn: 1, pollIntervalSec: 5 })
  })

  it('numbers tasks like issues and never reuses a number', () => {
    const { svc } = setup()
    const a = svc.createTask({ title: 'First' })
    const b = svc.createTask({ title: 'Second' })
    expect([a.number, b.number]).toEqual([1, 2])
    svc.deleteTask(b.id)
    expect(svc.createTask({ title: 'Third' }).number).toBe(3)
    expect(() => svc.createTask({ title: '   ' })).toThrow()
  })

  it('updates labels, closes and reopens', () => {
    const { svc, clock } = setup()
    const [l1, l2] = svc.listLabels()
    const t = svc.createTask({ title: 'Report', labelIds: [l1.id] })
    clock.now += MINUTE
    const closed = svc.updateTask(t.id, { status: 'closed', labelIds: [l1.id, l2.id] })
    expect(closed).toMatchObject({ status: 'closed', closedAt: clock.now })
    expect([...closed.labelIds].sort()).toEqual([l1.id, l2.id].sort())
    expect(svc.updateTask(t.id, { status: 'open' }).closedAt).toBeNull()
  })
})

describe('Service: time tracking', () => {
  it('counts a running timer and stops it when the task is closed', () => {
    const { svc, clock } = setup()
    const t = svc.createTask({ title: 'Focus' })
    svc.startTimer(t.id)
    clock.now += 25 * MINUTE
    expect(svc.getTask(t.id)!.trackedMs).toBe(25 * MINUTE)
    svc.updateTask(t.id, { status: 'closed' })
    expect(svc.getRunningTimer()).toBeNull()
    clock.now += 10 * MINUTE
    expect(svc.getTask(t.id)!.trackedMs).toBe(25 * MINUTE)
  })

  it('switching the timer closes the previous entry', () => {
    const { svc, clock } = setup()
    const a = svc.createTask({ title: 'A' })
    const b = svc.createTask({ title: 'B' })
    svc.startTimer(a.id)
    clock.now += 10 * MINUTE
    svc.startTimer(b.id)
    clock.now += 5 * MINUTE
    svc.stopTimer()
    expect(svc.getTask(a.id)!.trackedMs).toBe(10 * MINUTE)
    expect(svc.getTask(b.id)!.trackedMs).toBe(5 * MINUTE)
  })

  it('validates manual entries', () => {
    const { svc, clock } = setup()
    const t = svc.createTask({ title: 'Manual' })
    expect(() => svc.addTimeEntry({ taskId: t.id, start: clock.now, end: clock.now })).toThrow()
    svc.addTimeEntry({ taskId: t.id, start: clock.now - HOUR, end: clock.now, note: 'meeting' })
    expect(svc.getTask(t.id)!.trackedMs).toBe(HOUR)
  })
})

describe('Service: activity tracking', () => {
  it('merges samples into sessions and splits on app or title change', () => {
    const { svc, clock, sample } = setup()
    const start = clock.now
    sample('Code.exe', 'main.ts')
    clock.now += 5000
    sample('Code.exe', 'main.ts')
    clock.now += 5000
    const r = sample('chrome.exe', 'YouTube')
    clock.now += 5000
    sample('chrome.exe', 'YouTube')
    const sessions = svc.listSessions(start, clock.now + 1)
    expect(sessions.map((s) => [s.title, s.start - start, s.end - start])).toEqual([
      ['main.ts', 0, 10_000],
      ['YouTube', 10_000, 15_000]
    ])
    expect(r.state === 'active' && r.app.displayName).toBe('Chrome')
    const code = svc.listApps().find((a) => a.exeName === 'Code.exe')!
    expect(svc.listCategories().find((c) => c.id === code.categoryId)?.key).toBe('dev')
  })

  it('ends the session at the last input once idle', () => {
    const { svc, clock, sample } = setup()
    const t0 = clock.now
    for (let i = 0; i < 24; i++) {
      sample('vlc.exe', 'Movie')
      clock.now += 5000
    }
    const lastInput = clock.now - 5000
    while (clock.now - lastInput < 8 * MINUTE) {
      sample('vlc.exe', 'Movie', clock.now - lastInput)
      clock.now += 5000
    }
    expect(svc.listSessions(t0, clock.now)[0].end).toBe(lastInput)
    sample('vlc.exe', 'Movie')
    expect(svc.listSessions(t0, clock.now + 1)).toHaveLength(2)
  })

  it('does not record titles when disabled and skips ignored apps', () => {
    const { svc, clock, sample } = setup()
    const { app } = svc.ensureApp('C:\\Apps\\Telegram.exe', 'Telegram.exe')
    svc.updateApp(app.id, { recordTitles: false })
    sample('Telegram.exe', 'Chat with Alice')
    clock.now += 5000
    const ignored = svc.ensureApp('C:\\Apps\\secret.exe', 'secret.exe').app
    svc.updateApp(ignored.id, { ignored: true })
    expect(sample('secret.exe', 'x').state).toBe('ignored')
    const sessions = svc.listSessions(0, clock.now + 1)
    expect(sessions.map((s) => s.title)).toEqual([''])
  })

  it('attributes matching activity to a task via rules, unless a timer runs', () => {
    const { svc, clock, sample } = setup()
    const task = svc.createTask({ title: 'timehub' })
    const other = svc.createTask({ title: 'Other' })
    const { app: code } = svc.ensureApp('C:\\Apps\\Code.exe', 'Code.exe')
    svc.saveRule({ appId: code.id, titlePattern: 'timehub', taskId: task.id, categoryId: null })
    for (let i = 0; i <= 12; i++) {
      sample('Code.exe', 'service.ts — timehub')
      clock.now += 5000
    }
    sample('Code.exe', 'notes.txt')
    expect(svc.getTask(task.id)!.trackedMs).toBe(65_000)
    expect(svc.listTimeEntries({ taskId: task.id }).map((e) => e.source)).toEqual(['rule'])

    svc.startTimer(other.id)
    for (let i = 0; i < 6; i++) {
      clock.now += 5000
      sample('Code.exe', 'service.ts — timehub')
    }
    expect(svc.getTask(task.id)!.trackedMs).toBe(65_000)
  })

  it('recategorizes by title with category rules', () => {
    const { svc, clock, sample } = setup()
    const media = svc.listCategories().find((c) => c.key === 'media')!
    svc.saveRule({ appId: null, titlePattern: '/youtube|twitch/', taskId: null, categoryId: media.id })
    sample('chrome.exe', 'Lofi girl - YouTube')
    clock.now += 5000
    sample('chrome.exe', 'Lofi girl - YouTube')
    expect(svc.listSessions(0, clock.now + 1)[0].categoryId).toBe(media.id)
  })
})

describe('Service: recurring tasks', () => {
  it('generates one instance per day, idempotently, and tracks the streak', () => {
    const { svc, clock } = setup()
    const rec = svc.saveRecurrence({ title: 'Workout', rule: 'daily' })
    const instances = svc.listTasks().filter((t) => t.recurrenceId === rec.id)
    expect(instances.map((t) => t.plannedDate)).toEqual([dayKey(clock.now)])
    expect(svc.generateRecurring()).toBe(0)
    svc.updateTask(instances[0].id, { status: 'closed' })
    clock.now += DAY
    expect(svc.generateRecurring()).toBe(1)
    expect(svc.listRecurrences()[0]).toMatchObject({ streak: 1, doneTotal: 1 })
  })

  it('does not recreate a deleted instance on the same day', () => {
    const { svc } = setup()
    const rec = svc.saveRecurrence({ title: 'Read', rule: 'weekdays' })
    const [instance] = svc.listTasks().filter((t) => t.recurrenceId === rec.id)
    svc.deleteTask(instance.id)
    expect(svc.generateRecurring()).toBe(0)
  })

  it('deleting a recurrence keeps instances that have tracked time', () => {
    const { svc, clock } = setup()
    const rec = svc.saveRecurrence({ title: 'Stretch', rule: 'daily' })
    const [instance] = svc.listTasks()
    svc.addTimeEntry({ taskId: instance.id, start: clock.now - 10 * MINUTE, end: clock.now })
    svc.deleteRecurrence(rec.id)
    expect(svc.getTask(instance.id)).toMatchObject({ recurrenceId: null, trackedMs: 10 * MINUTE })
  })
})

describe('Service: stats and export', () => {
  it('splits daily totals at midnight and detects games', () => {
    const { svc } = setup()
    const { app } = svc.ensureApp('D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe', 'Hades.exe')
    expect(app.isGame).toBe(true)
    const midnight = new Date(2026, 8, 14).getTime()
    svc.seedSession(app.id, 'Hades', midnight - 30 * MINUTE, midnight + 90 * MINUTE)
    expect(svc.getDailyActive('2026-09-13', '2026-09-14')).toEqual([
      { date: '2026-09-13', value: 30 * MINUTE },
      { date: '2026-09-14', value: 90 * MINUTE }
    ])
    const usage = svc.getUsage(midnight, midnight + DAY)
    expect(usage.activeMs).toBe(90 * MINUTE)
    expect(svc.listCategories().find((c) => c.id === usage.byCategory[0].id)?.key).toBe('games')
  })

  it('builds a feed and exports', () => {
    const { svc, clock } = setup()
    const t = svc.createTask({ title: 'Ship v0.1' })
    clock.now += HOUR
    svc.updateTask(t.id, { status: 'closed' })
    expect(svc.getFeed().map((e) => e.kind)).toEqual(['task_closed', 'task_created'])
    expect(JSON.parse(svc.exportJson()).tables.tasks).toHaveLength(1)
    expect(svc.exportCsv().split('\r\n')[0]).toContain('type,start,end')
  })
})
