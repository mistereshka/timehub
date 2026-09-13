import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../main/db'
import { Service } from './service'
import { DAY, HOUR, MINUTE, dayKey } from './time'

function setup() {
  const clock = { now: new Date(2026, 8, 15, 9, 0, 0).getTime() } // Tuesday 09:00
  const svc = new Service(openNodeDb(':memory:'), { now: () => clock.now, language: 'ru' })
  return { svc, clock }
}

describe('goals', () => {
  it('derives progress from tasks, or uses the manual value', () => {
    const { svc } = setup()
    const goal = svc.saveGoal({ title: 'Выучить английский', manualProgress: 30 })
    expect(goal).toMatchObject({ progress: 30, autoProgress: true, taskCount: 0 })
    const a = svc.createTask({ title: 'Грамматика', goalId: goal.id })
    svc.createTask({ title: 'Словарь', goalId: goal.id })
    svc.updateTask(a.id, { status: 'closed' })
    expect(svc.getGoal(goal.id)).toMatchObject({ progress: 50, taskCount: 2, taskDone: 1 })
    expect(svc.saveGoal({ id: goal.id, title: goal.title, autoProgress: false }).progress).toBe(30)
    expect(svc.saveGoal({ id: goal.id, title: goal.title, status: 'achieved' })).toMatchObject({ progress: 100, status: 'achieved' })
  })

  it('tracks time on the goal and its tasks, and counts a streak', () => {
    const { svc, clock } = setup()
    const goal = svc.saveGoal({ title: 'timehub 1.0' })
    const task = svc.createTask({ title: 'Release notes', goalId: goal.id })
    svc.startGoalTimer(goal.id)
    clock.now += 30 * MINUTE
    svc.startTimer(task.id)
    clock.now += 15 * MINUTE
    svc.stopTimer()
    expect(svc.getGoal(goal.id)!.trackedMs).toBe(45 * MINUTE)
    expect(svc.listTimeEntries({ goalId: goal.id, withGoalTasks: true })).toHaveLength(2)
    svc.addTimeEntry({ goalId: goal.id, start: clock.now - DAY, end: clock.now - DAY + HOUR })
    expect(svc.getGoal(goal.id)!.streak).toBe(2)
    expect(svc.getGoalDays(goal.id, dayKey(clock.now - DAY), dayKey(clock.now)).map((d) => d.value)).toEqual([HOUR, 45 * MINUTE])
  })

  it('keeps a journal and lets a note set progress', () => {
    const { svc, clock } = setup()
    const goal = svc.saveGoal({ title: 'Полумарафон', autoProgress: false })
    svc.addGoalNote(goal.id, 'Пробежал 10 км', 40)
    clock.now += MINUTE
    svc.addGoalNote(goal.id, 'Купил кроссовки')
    expect(svc.listGoalNotes(goal.id).map((n) => n.body)).toEqual(['Купил кроссовки', 'Пробежал 10 км'])
    expect(svc.getGoal(goal.id)!.progress).toBe(40)
    expect(() => svc.addGoalNote(goal.id, '   ')).toThrow()
    expect(svc.getFeed().some((e) => e.kind === 'goal_note')).toBe(true)
  })

  it('stops the goal timer when the goal is achieved', () => {
    const { svc, clock } = setup()
    const goal = svc.saveGoal({ title: 'Ship it' })
    svc.startGoalTimer(goal.id)
    clock.now += 10 * MINUTE
    svc.saveGoal({ id: goal.id, title: 'Ship it', status: 'achieved' })
    expect(svc.getRunningTimer()).toBeNull()
  })
})

describe('subtasks and progress', () => {
  it('counts subtasks, inherits the goal and prevents cycles', () => {
    const { svc } = setup()
    const goal = svc.saveGoal({ title: 'Экзамен' })
    const parent = svc.createTask({ title: 'Подготовка', goalId: goal.id })
    const a = svc.createTask({ title: 'Пределы', parentId: parent.id })
    svc.createTask({ title: 'Интегралы', parentId: parent.id })
    expect(a.goalId).toBe(goal.id)
    svc.updateTask(a.id, { status: 'closed' })
    expect(svc.getTask(parent.id)).toMatchObject({ childCount: 2, childDone: 1 })
    expect(svc.listTasks({ parentId: parent.id })).toHaveLength(2)
    expect(() => svc.updateTask(parent.id, { parentId: a.id })).toThrow()
    expect(svc.updateTask(parent.id, { progress: 140 }).progress).toBe(100)
    expect(svc.updateTask(parent.id, { progress: null }).progress).toBeNull()
  })
})

describe('recurring targets', () => {
  it('creates timed instances and closes them once the target time is tracked', () => {
    const { svc, clock } = setup()
    // English on Tuesdays and Fridays at 19:00, two hours
    const rec = svc.saveRecurrence({
      title: 'Английский', rule: 'weekly', daysMask: 0b0010010, timeOfDay: '19:00', estimateMin: 120, completeOnTarget: true
    })
    const [instance] = svc.listTasks().filter((t) => t.recurrenceId === rec.id)
    expect(instance).toMatchObject({ plannedDate: dayKey(clock.now), plannedTime: '19:00', estimateMin: 120 })
    svc.startTimer(instance.id)
    clock.now += 90 * MINUTE
    expect(svc.checkTargets()).toBe(0)
    clock.now += 31 * MINUTE
    expect(svc.checkTargets()).toBe(1)
    expect(svc.getTask(instance.id)!.status).toBe('closed')
    expect(svc.getRunningTimer()).toBeNull()
    expect(svc.getTask(instance.id)!.streak).toBe(1)
    expect(() => svc.saveRecurrence({ title: 'x', rule: 'daily', timeOfDay: '25:00' })).toThrow()
  })
})

describe('rules, music, calendar and connections', () => {
  it('can attribute app time to a goal', () => {
    const { svc, clock } = setup()
    const goal = svc.saveGoal({ title: 'timehub' })
    const { app } = svc.ensureApp('C:\\Apps\\Code.exe', 'Code.exe')
    svc.saveRule({ appId: app.id, titlePattern: 'timehub', taskId: null, goalId: goal.id, categoryId: null })
    const sample = (): void =>
      void svc.recordSample(
        { at: clock.now, exePath: 'C:\\Apps\\Code.exe', exeName: 'Code.exe', title: 'main.ts - timehub - Visual Studio Code', idleMs: 0 },
        { intervalMs: 5000, idleThresholdMs: 5 * MINUTE }
      )
    for (let i = 0; i <= 12; i++) {
      sample()
      clock.now += 5000
    }
    expect(svc.getGoal(goal.id)!.trackedMs).toBe(60_000)
    const report = svc.getAppReport(app.id)
    expect(report.projects).toEqual([{ name: 'timehub', ms: 60_000 }])
    expect(report.totalMs).toBe(60_000)
  })

  it('records listening sessions and summarizes them', () => {
    const { svc, clock } = setup()
    const play = (title: string, playing = true): void =>
      svc.recordMedia({ at: clock.now, source: 'Spotify.exe', title, artist: 'Daft Punk', album: 'Discovery', playing }, 5000)
    for (let i = 0; i < 10; i++) {
      play('One More Time')
      clock.now += 5000
    }
    play('Aerodynamic')
    clock.now += 5000
    play('Aerodynamic')
    clock.now += 5000
    play('Aerodynamic', false)
    const music = svc.getMusic(0, clock.now + 1)
    expect(music.topArtists[0]).toMatchObject({ name: 'Daft Punk', plays: 2 })
    expect(music.topTracks.map((t) => t.title)).toEqual(['One More Time', 'Aerodynamic'])
    expect(music.totalMs).toBe(60_000)
  })

  it('stores calendar events, integrations and external day stats', () => {
    const { svc, clock } = setup()
    svc.replaceCalendarEvents('work', clock.now - DAY, clock.now + DAY, [
      { uid: 'a', title: 'Standup', location: '', start: clock.now + HOUR, end: clock.now + HOUR + 15 * MINUTE, allDay: false, color: '#0969da' }
    ])
    expect(svc.listCalendarEvents(clock.now, clock.now + DAY).map((e) => e.title)).toEqual(['Standup'])
    svc.replaceCalendarEvents('work', clock.now - DAY, clock.now + DAY, [])
    expect(svc.listCalendarEvents(clock.now, clock.now + DAY)).toEqual([])

    svc.saveIntegration('steam', { enabled: true, config: { apiKey: 'x' } })
    svc.saveIntegration('steam', { state: { games: 17 } })
    expect(svc.getIntegration('steam')).toMatchObject({ enabled: true, config: { apiKey: 'x' }, state: { games: 17 } })

    svc.setExternalDays('github', [{ date: dayKey(clock.now), value: 5 }])
    expect(svc.getHeatmap('github', dayKey(clock.now - DAY), dayKey(clock.now)).map((d) => d.value)).toEqual([0, 5])
  })
})
