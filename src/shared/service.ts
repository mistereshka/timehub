import { transaction, type Row, type SqlDb, type SqlValue } from './sql'
import { migrate } from './migrations'
import type * as T from './types'
import { DAY, MINUTE, addDays, clipDuration, dayKey, endOfDayMs, startOfDayMs, todayKey } from './time'
import { computeStreak, occursOn } from './recurrence'
import { DEFAULT_CATEGORIES, DEFAULT_LABELS, guessCategoryKey, looksLikeGame, prettifyExeName } from './catalog'

export interface ServiceOptions {
  now?: () => number
  onChange?: (topic: T.ChangeTopic) => void
  /** Language used to seed a brand-new database */
  language?: T.Lang
}

/** One observation of the foreground window, taken every poll interval. */
export interface ActivitySample {
  at: number
  exePath: string
  exeName: string
  title: string
  /** Time since the last keyboard/mouse input */
  idleMs: number
  /** Friendly name from the executable's version info, if known */
  displayName?: string
}

export interface SampleOptions {
  intervalMs: number
  idleThresholdMs: number
}

export type SampleResult =
  | { state: 'idle' }
  | { state: 'ignored'; app: T.AppInfo }
  | { state: 'active'; app: T.AppInfo; title: string; since: number; created: boolean }

interface OpenSpan {
  id: T.ID
  start: number
  end: number
}
interface OpenSession extends OpenSpan {
  appId: T.ID
  title: string
  ruleTaskId: T.ID | null
}
interface OpenRuleEntry extends OpenSpan {
  taskId: T.ID
}

const MIN_SPAN_MS = 1000
const MAX_TITLE_LENGTH = 300

export function defaultSettings(language: T.Lang): T.Settings {
  return {
    language,
    theme: 'system',
    pollIntervalSec: 5,
    idleThresholdMin: 5,
    autostart: false,
    closeToTray: true,
    trackingPaused: false,
    heatmapMetric: 'active',
    weekStartsOn: language === 'ru' ? 1 : 0
  }
}

/** Empty pattern matches everything; `/.../` is a case-insensitive regex; otherwise a substring. */
export function patternMatches(pattern: string, title: string): boolean {
  const p = pattern.trim()
  if (!p) return true
  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) {
    try {
      return new RegExp(p.slice(1, -1), 'i').test(title)
    } catch {
      return false
    }
  }
  return title.toLowerCase().includes(p.toLowerCase())
}

const bool = (v: unknown): boolean => v === 1 || v === true
const idList = (v: unknown): T.ID[] => (v == null || v === '' ? [] : String(v).split(',').map(Number))

function required(value: string, what: string): string {
  const v = value.trim()
  if (!v) throw new Error(`${what} is required`)
  return v
}

function bump<K>(map: Map<K, number>, key: K, ms: number): void {
  map.set(key, (map.get(key) ?? 0) + ms)
}

const sortedItems = (map: Map<T.ID, number>): T.UsageItem[] =>
  [...map].map(([id, ms]) => ({ id, ms })).sort((a, b) => b.ms - a.ms)

function eachDay(fromKey: string, toKey: string, value: (key: string) => number): T.DayValue[] {
  const out: T.DayValue[] = []
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) out.push({ date: key, value: value(key) })
  return out
}

const toProject = (r: Row): T.Project => ({
  id: r.id, name: r.name, color: r.color, description: r.description, archived: bool(r.archived), createdAt: r.created_at
})
const toLabel = (r: Row): T.Label => ({ id: r.id, name: r.name, color: r.color, description: r.description })
const toTask = (r: Row): T.Task => ({
  id: r.id, number: r.number, title: r.title, body: r.body, status: r.status, priority: r.priority,
  projectId: r.project_id, labelIds: idList(r.label_ids), dueDate: r.due_date, plannedDate: r.planned_date,
  estimateMin: r.estimate_min, recurrenceId: r.recurrence_id, sortOrder: r.sort_order,
  createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, trackedMs: r.tracked_ms ?? 0
})
const toEntry = (r: Row): T.TimeEntry => ({
  id: r.id, taskId: r.task_id, taskNumber: r.task_number, taskTitle: r.task_title,
  start: r.start_ms, end: r.end_ms, source: r.source, note: r.note
})
const toCategory = (r: Row): T.Category => ({ id: r.id, key: r.key, name: r.name, color: r.color })
const toApp = (r: Row): T.AppInfo => ({
  id: r.id, exePath: r.exe_path, exeName: r.exe_name, displayName: r.display_name, icon: r.icon,
  categoryId: r.category_id, recordTitles: bool(r.record_titles), ignored: bool(r.ignored),
  isGame: bool(r.is_game), firstSeen: r.first_seen
})
const toSession = (r: Row): T.ActivitySession => ({
  id: r.id, appId: r.app_id, title: r.title, start: r.start_ms, end: r.end_ms, taskId: r.task_id, categoryId: r.category_id
})
const toRule = (r: Row): T.Rule => ({
  id: r.id, appId: r.app_id, titlePattern: r.title_pattern, taskId: r.task_id, categoryId: r.category_id, createdAt: r.created_at
})
function toRecurrence(r: Row): Omit<T.Recurrence, 'streak' | 'doneTotal'> {
  return {
    id: r.id, title: r.title, body: r.body, rule: r.rule, daysMask: r.days_mask, dayOfMonth: r.day_of_month,
    projectId: r.project_id, labelIds: idList(r.label_ids), estimateMin: r.estimate_min, active: bool(r.active),
    startDate: r.start_date, lastGenerated: r.last_generated, createdAt: r.created_at
  }
}

// The first `?` is "now", used as the end of a running timer.
const TASK_SELECT = `SELECT t.*,
  (SELECT group_concat(label_id) FROM task_labels tl WHERE tl.task_id = t.id) AS label_ids,
  (SELECT COALESCE(SUM(COALESCE(e.end_ms, ?) - e.start_ms), 0) FROM time_entries e WHERE e.task_id = t.id) AS tracked_ms
  FROM tasks t`

const ENTRY_SELECT = `SELECT e.*, t.number AS task_number, t.title AS task_title
  FROM time_entries e JOIN tasks t ON t.id = e.task_id`

const SESSION_SELECT = `SELECT s.id, s.app_id, s.title, s.start_ms, s.end_ms, s.task_id,
  COALESCE(s.category_id, a.category_id, (SELECT id FROM categories WHERE key = 'other')) AS category_id
  FROM activity_sessions s JOIN apps a ON a.id = s.app_id`

/**
 * All of timehub's data logic. Synchronous and platform-agnostic: the Electron
 * main process wraps it with IPC, the browser demo calls it directly.
 */
export class Service {
  private readonly now: () => number
  private readonly notify: (topic: T.ChangeTopic) => void
  private readonly appCache = new Map<string, T.AppInfo>()
  private rulesCache: T.Rule[] | null = null
  private cur: OpenSession | null = null
  private appSince = 0
  private ruleEntry: OpenRuleEntry | null = null

  constructor(
    private readonly db: SqlDb,
    options: ServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.notify = options.onChange ?? (() => {})
    if (migrate(db).created) this.seed(options.language ?? 'en')
  }

  // ------------------------------------------------------------------ settings

  getSettings(): T.Settings {
    const stored: Record<string, unknown> = {}
    for (const r of this.db.all('SELECT key, value FROM settings')) {
      if (!String(r.key).startsWith('_')) stored[r.key] = JSON.parse(r.value)
    }
    return { ...defaultSettings(stored.language === 'ru' ? 'ru' : 'en'), ...stored } as T.Settings
  }

  updateSettings(patch: Partial<T.Settings>): T.Settings {
    transaction(this.db, () => {
      for (const [key, value] of Object.entries(patch)) if (value !== undefined) this.writeSetting(key, value)
    })
    this.notify('settings')
    return this.getSettings()
  }

  private readSetting(key: string): unknown {
    const row = this.db.get('SELECT value FROM settings WHERE key = ?', [key])
    return row ? JSON.parse(row.value) : undefined
  }

  private writeSetting(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)]
    )
  }

  // ------------------------------------------------------- projects & labels

  listProjects(): T.Project[] {
    return this.db.all('SELECT * FROM projects ORDER BY archived, name COLLATE NOCASE').map(toProject)
  }

  saveProject(input: T.ProjectInput): T.Project {
    const values = [required(input.name, 'Project name'), input.color, input.description?.trim() ?? '', input.archived ? 1 : 0]
    let id = input.id
    if (id != null) {
      this.db.run('UPDATE projects SET name = ?, color = ?, description = ?, archived = ? WHERE id = ?', [...values, id])
    } else {
      id = this.db.run('INSERT INTO projects (name, color, description, archived, created_at) VALUES (?, ?, ?, ?, ?)', [
        ...values,
        this.now()
      ]).lastId
    }
    this.notify('meta')
    return toProject(this.db.get('SELECT * FROM projects WHERE id = ?', [id])!)
  }

  deleteProject(id: T.ID): void {
    this.db.run('DELETE FROM projects WHERE id = ?', [id])
    this.notify('meta')
    this.notify('tasks')
  }

  listLabels(): T.Label[] {
    return this.db.all('SELECT * FROM labels ORDER BY name COLLATE NOCASE').map(toLabel)
  }

  saveLabel(input: T.LabelInput): T.Label {
    const values = [required(input.name, 'Label name'), input.color, input.description?.trim() ?? '']
    let id = input.id
    if (id != null) {
      this.db.run('UPDATE labels SET name = ?, color = ?, description = ? WHERE id = ?', [...values, id])
    } else {
      id = this.db.run('INSERT INTO labels (name, color, description) VALUES (?, ?, ?)', values).lastId
    }
    this.notify('meta')
    this.notify('tasks')
    return toLabel(this.db.get('SELECT * FROM labels WHERE id = ?', [id])!)
  }

  deleteLabel(id: T.ID): void {
    this.db.run('DELETE FROM labels WHERE id = ?', [id])
    this.notify('meta')
    this.notify('tasks')
  }

  // --------------------------------------------------------------------- tasks

  listTasks(filter: { status?: T.TaskStatus } = {}): T.Task[] {
    const params: SqlValue[] = [this.now()]
    let where = ''
    if (filter.status) {
      where = 'WHERE t.status = ?'
      params.push(filter.status)
    }
    return this.db.all(`${TASK_SELECT} ${where} ORDER BY t.number DESC`, params).map(toTask)
  }

  getTask(id: T.ID): T.Task | null {
    const row = this.db.get(`${TASK_SELECT} WHERE t.id = ?`, [this.now(), id])
    return row ? toTask(row) : null
  }

  getTaskByNumber(number: number): T.Task | null {
    const row = this.db.get(`${TASK_SELECT} WHERE t.number = ?`, [this.now(), number])
    return row ? toTask(row) : null
  }

  createTask(input: T.TaskInput): T.Task {
    const id = this.insertTask(input, null)
    this.notify('tasks')
    return this.getTask(id)!
  }

  updateTask(id: T.ID, patch: T.TaskPatch): T.Task {
    const now = this.now()
    const sets: string[] = []
    const params: SqlValue[] = []
    const set = (column: string, value: SqlValue): void => {
      sets.push(`${column} = ?`)
      params.push(value)
    }
    if (patch.title !== undefined) set('title', required(patch.title, 'Title'))
    if (patch.body !== undefined) set('body', patch.body)
    if (patch.priority !== undefined) set('priority', patch.priority)
    if (patch.projectId !== undefined) set('project_id', patch.projectId)
    if (patch.dueDate !== undefined) set('due_date', patch.dueDate)
    if (patch.plannedDate !== undefined) set('planned_date', patch.plannedDate)
    if (patch.estimateMin !== undefined) set('estimate_min', patch.estimateMin)
    const closing = patch.status === 'closed'
    if (patch.status !== undefined) {
      const current = this.db.get('SELECT status FROM tasks WHERE id = ?', [id])
      if (current && current.status !== patch.status) {
        set('status', patch.status)
        set('closed_at', closing ? now : null)
      }
    }
    set('updated_at', now)
    let timerStopped = false
    transaction(this.db, () => {
      this.db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
      if (patch.labelIds) this.setTaskLabels(id, patch.labelIds)
      if (closing) timerStopped = this.closeRunningEntries(now, id)
    })
    this.notify('tasks')
    if (timerStopped) this.notify('time')
    const task = this.getTask(id)
    if (!task) throw new Error('Task not found')
    return task
  }

  deleteTask(id: T.ID): void {
    this.db.run('DELETE FROM tasks WHERE id = ?', [id])
    this.rulesCache = null
    if (this.ruleEntry?.taskId === id) this.ruleEntry = null
    this.notify('tasks')
    this.notify('time')
    this.notify('meta')
  }

  /** Persists a manual ordering (e.g. drag & drop on the Today page). */
  reorderTasks(ids: T.ID[]): void {
    transaction(this.db, () => {
      ids.forEach((id, i) => this.db.run('UPDATE tasks SET sort_order = ? WHERE id = ?', [i + 1, id]))
    })
    this.notify('tasks')
  }

  private insertTask(input: T.TaskInput, recurrenceId: T.ID | null): T.ID {
    const title = required(input.title, 'Title')
    const now = this.now()
    return transaction(this.db, () => {
      const maxNumber = this.db.get('SELECT COALESCE(MAX(number), 0) AS n FROM tasks')!.n as number
      const number = Math.max(maxNumber, Number(this.readSetting('_taskSeq') ?? 0)) + 1
      this.writeSetting('_taskSeq', number)
      const sort = this.db.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS s FROM tasks')!.s as number
      const { lastId } = this.db.run(
        `INSERT INTO tasks (number, title, body, status, priority, project_id, due_date, planned_date,
          estimate_min, recurrence_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          number, title, input.body ?? '', input.priority ?? 0, input.projectId ?? null, input.dueDate ?? null,
          input.plannedDate ?? null, input.estimateMin ?? null, recurrenceId, sort, now, now
        ]
      )
      this.setTaskLabels(lastId, input.labelIds ?? [])
      return lastId
    })
  }

  private setTaskLabels(taskId: T.ID, labelIds: T.ID[]): void {
    this.db.run('DELETE FROM task_labels WHERE task_id = ?', [taskId])
    for (const labelId of new Set(labelIds)) {
      // Silently skips labels that no longer exist (recurrences keep plain id lists).
      this.db.run('INSERT OR IGNORE INTO task_labels (task_id, label_id) SELECT ?, id FROM labels WHERE id = ?', [taskId, labelId])
    }
  }

  // ---------------------------------------------------------- time tracking

  listTimeEntries(q: { taskId?: T.ID; from?: number; to?: number } = {}): T.TimeEntry[] {
    const where: string[] = []
    const params: SqlValue[] = []
    if (q.taskId != null) {
      where.push('e.task_id = ?')
      params.push(q.taskId)
    }
    if (q.from != null) {
      where.push('COALESCE(e.end_ms, ?) > ?')
      params.push(this.now(), q.from)
    }
    if (q.to != null) {
      where.push('e.start_ms < ?')
      params.push(q.to)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return this.db.all(`${ENTRY_SELECT} ${clause} ORDER BY e.start_ms DESC`, params).map(toEntry)
  }

  getRunningTimer(): T.RunningTimer | null {
    const r = this.db.get(`${ENTRY_SELECT} WHERE e.end_ms IS NULL ORDER BY e.start_ms DESC LIMIT 1`)
    return r ? { entryId: r.id, taskId: r.task_id, taskNumber: r.task_number, taskTitle: r.task_title, start: r.start_ms } : null
  }

  /** Starts a timer on the task; any running timer is stopped first. */
  startTimer(taskId: T.ID): T.RunningTimer {
    const now = this.now()
    transaction(this.db, () => {
      this.closeRunningEntries(now)
      this.finishRuleEntry()
      this.db.run(`INSERT INTO time_entries (task_id, start_ms, end_ms, source, note) VALUES (?, ?, NULL, 'timer', '')`, [taskId, now])
    })
    this.notify('time')
    this.notify('tasks')
    return this.getRunningTimer()!
  }

  stopTimer(): void {
    if (this.closeRunningEntries(this.now())) {
      this.notify('time')
      this.notify('tasks')
    }
  }

  private closeRunningEntries(at: number, taskId?: T.ID): boolean {
    const onlyTask = taskId != null ? ' AND task_id = ?' : ''
    const params: SqlValue[] = taskId != null ? [at, taskId] : [at]
    const { changes } = this.db.run(`UPDATE time_entries SET end_ms = MAX(start_ms, ?) WHERE end_ms IS NULL${onlyTask}`, params)
    // A start/stop misclick shouldn't leave a zero-length entry behind.
    this.db.run(`DELETE FROM time_entries WHERE source = 'timer' AND end_ms IS NOT NULL AND end_ms - start_ms < ? AND start_ms > ?`, [
      MIN_SPAN_MS,
      at - MIN_SPAN_MS
    ])
    return changes > 0
  }

  addTimeEntry(input: T.TimeEntryInput): T.TimeEntry {
    validateSpan(input.start, input.end)
    const { lastId } = this.db.run(
      `INSERT INTO time_entries (task_id, start_ms, end_ms, source, note) VALUES (?, ?, ?, 'manual', ?)`,
      [input.taskId, input.start, input.end, input.note?.trim() ?? '']
    )
    this.notify('time')
    this.notify('tasks')
    return toEntry(this.db.get(`${ENTRY_SELECT} WHERE e.id = ?`, [lastId])!)
  }

  updateTimeEntry(id: T.ID, patch: T.TimeEntryPatch): T.TimeEntry {
    const current = this.db.get('SELECT * FROM time_entries WHERE id = ?', [id])
    if (!current) throw new Error('Time entry not found')
    const start = patch.start ?? current.start_ms
    const end = patch.end ?? current.end_ms
    if (end != null) validateSpan(start, end)
    this.db.run('UPDATE time_entries SET start_ms = ?, end_ms = ?, note = ? WHERE id = ?', [
      start, end, patch.note?.trim() ?? current.note, id
    ])
    this.notify('time')
    this.notify('tasks')
    return toEntry(this.db.get(`${ENTRY_SELECT} WHERE e.id = ?`, [id])!)
  }

  deleteTimeEntry(id: T.ID): void {
    this.db.run('DELETE FROM time_entries WHERE id = ?', [id])
    if (this.ruleEntry?.id === id) this.ruleEntry = null
    this.notify('time')
    this.notify('tasks')
  }

  // -------------------------------------------------------------- recurrences

  listRecurrences(): T.Recurrence[] {
    const today = todayKey(this.now())
    const done = new Map<T.ID, Set<string>>()
    const closed = this.db.all(
      `SELECT recurrence_id AS rid, planned_date AS d FROM tasks
       WHERE recurrence_id IS NOT NULL AND status = 'closed' AND planned_date IS NOT NULL`
    )
    for (const r of closed) {
      const set = done.get(r.rid) ?? new Set<string>()
      set.add(r.d)
      done.set(r.rid, set)
    }
    return this.db.all('SELECT * FROM recurrences ORDER BY active DESC, created_at').map((r) => {
      const base = toRecurrence(r)
      const dates = done.get(base.id) ?? new Set<string>()
      return { ...base, streak: computeStreak(base, dates, today), doneTotal: dates.size }
    })
  }

  saveRecurrence(input: T.RecurrenceInput): T.Recurrence {
    const title = required(input.title, 'Title')
    if (input.rule === 'weekly' && !((input.daysMask ?? 0) & 0x7f)) throw new Error('Pick at least one weekday')
    const today = todayKey(this.now())
    const values: SqlValue[] = [
      title, input.body ?? '', input.rule, input.daysMask ?? 0, input.dayOfMonth ?? null, input.projectId ?? null,
      (input.labelIds ?? []).join(','), input.estimateMin ?? null, input.active === false ? 0 : 1
    ]
    let id = input.id
    if (id != null) {
      this.db.run(
        `UPDATE recurrences SET title = ?, body = ?, rule = ?, days_mask = ?, day_of_month = ?, project_id = ?,
          label_ids = ?, estimate_min = ?, active = ?, start_date = COALESCE(?, start_date) WHERE id = ?`,
        [...values, input.startDate ?? null, id]
      )
    } else {
      id = this.db.run(
        `INSERT INTO recurrences (title, body, rule, days_mask, day_of_month, project_id, label_ids, estimate_min,
          active, start_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values, input.startDate ?? today, this.now()]
      ).lastId
    }
    this.notify('meta')
    this.generateRecurring(today)
    return this.listRecurrences().find((r) => r.id === id)!
  }

  /** Deletes the recurrence and today's/future open instances that have no tracked time. */
  deleteRecurrence(id: T.ID): void {
    const today = todayKey(this.now())
    transaction(this.db, () => {
      this.db.run(
        `DELETE FROM tasks WHERE recurrence_id = ? AND status = 'open' AND planned_date >= ?
           AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = tasks.id)`,
        [id, today]
      )
      this.db.run('DELETE FROM recurrences WHERE id = ?', [id])
    })
    this.notify('meta')
    this.notify('tasks')
  }

  /**
   * Creates today's instances of active recurrences. Idempotent: each
   * recurrence remembers the last day it generated, so a deleted instance
   * isn't recreated and missed days don't pile up.
   */
  generateRecurring(today: string = todayKey(this.now())): number {
    const due = this.db.all(
      `SELECT * FROM recurrences WHERE active = 1 AND start_date <= ? AND (last_generated IS NULL OR last_generated < ?)`,
      [today, today]
    )
    let created = 0
    transaction(this.db, () => {
      for (const row of due) {
        const rec = toRecurrence(row)
        const exists = this.db.get('SELECT 1 AS x FROM tasks WHERE recurrence_id = ? AND planned_date = ?', [rec.id, today])
        if (occursOn(rec, today) && !exists) {
          this.insertTask(
            { title: rec.title, body: rec.body, projectId: rec.projectId, labelIds: rec.labelIds, estimateMin: rec.estimateMin, plannedDate: today },
            rec.id
          )
          created++
        }
        this.db.run('UPDATE recurrences SET last_generated = ? WHERE id = ?', [today, rec.id])
      }
    })
    if (created) this.notify('tasks')
    return created
  }

  // ------------------------------------------------------ categories & apps

  listCategories(): T.Category[] {
    return this.db.all('SELECT * FROM categories ORDER BY key IS NULL, id').map(toCategory)
  }

  saveCategory(input: T.CategoryInput): T.Category {
    const values = [required(input.name, 'Category name'), input.color]
    let id = input.id
    if (id != null) this.db.run('UPDATE categories SET name = ?, color = ? WHERE id = ?', [...values, id])
    else id = this.db.run('INSERT INTO categories (key, name, color) VALUES (NULL, ?, ?)', values).lastId
    this.notify('meta')
    this.notify('activity')
    return toCategory(this.db.get('SELECT * FROM categories WHERE id = ?', [id])!)
  }

  /** Built-in categories can be recolored but not deleted. */
  deleteCategory(id: T.ID): void {
    this.db.run('DELETE FROM categories WHERE id = ? AND key IS NULL', [id])
    this.appCache.clear()
    this.notify('meta')
    this.notify('activity')
  }

  listApps(): T.AppInfo[] {
    return this.db.all('SELECT * FROM apps ORDER BY display_name COLLATE NOCASE').map(toApp)
  }

  updateApp(id: T.ID, patch: T.AppPatch): T.AppInfo {
    const sets: string[] = []
    const params: SqlValue[] = []
    if (patch.displayName !== undefined) {
      sets.push('display_name = ?')
      params.push(required(patch.displayName, 'Name'))
    }
    if (patch.categoryId !== undefined) {
      sets.push('category_id = ?')
      params.push(patch.categoryId)
    }
    for (const [key, column] of [['recordTitles', 'record_titles'], ['ignored', 'ignored'], ['isGame', 'is_game']] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`)
        params.push(patch[key] ? 1 : 0)
      }
    }
    transaction(this.db, () => {
      if (sets.length) this.db.run(`UPDATE apps SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
      if (patch.scrubTitles) this.db.run(`UPDATE activity_sessions SET title = '' WHERE app_id = ?`, [id])
    })
    this.appCache.clear()
    // Start a fresh session so the new settings apply right away.
    if (this.cur?.appId === id) this.cur = null
    this.notify('meta')
    this.notify('activity')
    return toApp(this.db.get('SELECT * FROM apps WHERE id = ?', [id])!)
  }

  setAppIcon(id: T.ID, icon: string): void {
    this.db.run('UPDATE apps SET icon = ? WHERE id = ?', [icon, id])
    this.appCache.clear()
    this.notify('meta')
  }

  ensureApp(exePath: string, exeName: string, displayName?: string): { app: T.AppInfo; created: boolean } {
    const path = exePath || exeName
    const key = path.toLowerCase()
    const cached = this.appCache.get(key)
    if (cached) return { app: cached, created: false }
    let row = this.db.get('SELECT * FROM apps WHERE exe_path = ?', [path])
    let created = false
    if (!row) {
      const isGame = looksLikeGame(exeName, exePath)
      const category = this.db.get('SELECT id FROM categories WHERE key = ?', [guessCategoryKey(exeName, isGame)])
      const name = displayName?.trim() || prettifyExeName(exeName)
      const { lastId } = this.db.run(
        'INSERT INTO apps (exe_path, exe_name, display_name, category_id, is_game, first_seen) VALUES (?, ?, ?, ?, ?, ?)',
        [path, exeName, name, category?.id ?? null, isGame ? 1 : 0, this.now()]
      )
      row = this.db.get('SELECT * FROM apps WHERE id = ?', [lastId])!
      created = true
      this.notify('meta')
    }
    const app = toApp(row)
    this.appCache.set(key, app)
    return { app, created }
  }

  // --------------------------------------------------------- activity tracking

  listSessions(from: number, to: number): T.ActivitySession[] {
    return this.db
      .all(`${SESSION_SELECT} WHERE a.ignored = 0 AND s.end_ms > ? AND s.start_ms < ? ORDER BY s.start_ms`, [from, to])
      .map(toSession)
  }

  /** Inserts a finished session directly (demo data, imports). */
  seedSession(appId: T.ID, title: string, start: number, end: number, taskId: T.ID | null = null): void {
    this.db.run('INSERT INTO activity_sessions (app_id, title, start_ms, end_ms, task_id) VALUES (?, ?, ?, ?, ?)', [
      appId, title, start, end, taskId
    ])
  }

  /**
   * Folds one foreground-window sample into the session log. Consecutive
   * samples of the same app + title extend one session; anything else closes
   * it and starts the next one exactly where the previous ended.
   */
  recordSample(s: ActivitySample, o: SampleOptions): SampleResult {
    if (s.idleMs >= o.idleThresholdMs) {
      this.closeActivity(s.at - s.idleMs)
      return { state: 'idle' }
    }
    const { app, created } = this.ensureApp(s.exePath, s.exeName, s.displayName)
    const maxGap = o.intervalMs * 2 + 2000
    if (app.ignored) {
      // Switching to an ignored app ends the previous activity at the switch, like any app change.
      if (this.cur && s.at - this.cur.end <= maxGap) this.extendSpan('activity_sessions', this.cur, s.at)
      if (this.ruleEntry && s.at - this.ruleEntry.end <= maxGap) this.extendSpan('time_entries', this.ruleEntry, s.at)
      this.closeActivity(s.at)
      return { state: 'ignored', app }
    }
    const title = app.recordTitles ? s.title.trim().slice(0, MAX_TITLE_LENGTH) : ''
    const timer = this.getRunningTimer()
    const cur = this.cur
    const continuous = cur != null && s.at - cur.end <= maxGap

    if (cur && continuous && cur.appId === app.id && cur.title === title) {
      this.extendSpan('activity_sessions', cur, s.at)
    } else {
      if (cur && continuous) this.extendSpan('activity_sessions', cur, s.at)
      else if (cur) this.dropIfEmpty('activity_sessions', cur)
      if (!cur || !continuous || cur.appId !== app.id) this.appSince = s.at
      const match = this.matchRules(app.id, title)
      const { lastId } = this.db.run(
        'INSERT INTO activity_sessions (app_id, title, start_ms, end_ms, task_id, category_id) VALUES (?, ?, ?, ?, ?, ?)',
        [app.id, title, s.at, s.at, timer?.taskId ?? match.taskId, match.categoryId]
      )
      this.cur = { id: lastId, appId: app.id, title, start: s.at, end: s.at, ruleTaskId: match.taskId }
    }

    // A running timer wins over rule-based attribution, so time is never counted twice.
    this.trackRuleTime(timer ? null : (this.cur?.ruleTaskId ?? null), s.at, maxGap)
    this.notify('activity')
    return { state: 'active', app, title, since: this.appSince, created }
  }

  /** Ends the open session (idle, lock, sleep, pause, quit), never past the last sample. */
  closeActivity(at: number): void {
    const close = (table: string, span: OpenSpan): void => {
      const end = Math.max(span.start, Math.min(at, span.end))
      if (end - span.start < MIN_SPAN_MS) this.db.run(`DELETE FROM ${table} WHERE id = ?`, [span.id])
      else if (end !== span.end) this.db.run(`UPDATE ${table} SET end_ms = ? WHERE id = ?`, [end, span.id])
    }
    const hadRuleEntry = this.ruleEntry != null
    if (this.cur) close('activity_sessions', this.cur)
    if (this.ruleEntry) close('time_entries', this.ruleEntry)
    const changed = this.cur != null || hadRuleEntry
    this.cur = null
    this.ruleEntry = null
    if (changed) this.notify('activity')
    if (hadRuleEntry) this.notify('time')
  }

  private extendSpan(table: string, span: OpenSpan, at: number): void {
    span.end = at
    this.db.run(`UPDATE ${table} SET end_ms = ? WHERE id = ?`, [at, span.id])
  }

  private dropIfEmpty(table: string, span: OpenSpan): void {
    if (span.end - span.start < MIN_SPAN_MS) this.db.run(`DELETE FROM ${table} WHERE id = ?`, [span.id])
  }

  private trackRuleTime(taskId: T.ID | null, at: number, maxGap: number): void {
    const entry = this.ruleEntry
    const continuous = entry != null && at - entry.end <= maxGap
    if (entry && continuous && entry.taskId === taskId) {
      this.extendSpan('time_entries', entry, at)
      this.notify('time')
      return
    }
    if (entry) {
      if (continuous) this.extendSpan('time_entries', entry, at)
      this.finishRuleEntry()
    }
    if (taskId != null) {
      const { lastId } = this.db.run(
        `INSERT INTO time_entries (task_id, start_ms, end_ms, source, note) VALUES (?, ?, ?, 'rule', '')`,
        [taskId, at, at]
      )
      this.ruleEntry = { id: lastId, taskId, start: at, end: at }
      this.notify('time')
    }
  }

  private finishRuleEntry(): void {
    if (this.ruleEntry) this.dropIfEmpty('time_entries', this.ruleEntry)
    this.ruleEntry = null
  }

  // --------------------------------------------------------------------- rules

  listRules(): T.Rule[] {
    return this.rules()
  }

  private rules(): T.Rule[] {
    this.rulesCache ??= this.db.all('SELECT * FROM rules ORDER BY id').map(toRule)
    return this.rulesCache
  }

  saveRule(input: T.RuleInput): T.Rule {
    const pattern = input.titlePattern.trim()
    if (input.appId == null && !pattern) throw new Error('A rule needs an app or a title pattern')
    if (input.taskId == null && input.categoryId == null) throw new Error('A rule needs a task or a category')
    const values: SqlValue[] = [input.appId, pattern, input.taskId, input.categoryId]
    let id = input.id
    if (id != null) {
      this.db.run('UPDATE rules SET app_id = ?, title_pattern = ?, task_id = ?, category_id = ? WHERE id = ?', [...values, id])
    } else {
      id = this.db.run('INSERT INTO rules (app_id, title_pattern, task_id, category_id, created_at) VALUES (?, ?, ?, ?, ?)', [
        ...values,
        this.now()
      ]).lastId
    }
    this.rulesCache = null
    this.cur = null
    this.finishRuleEntry()
    this.notify('meta')
    return this.rules().find((r) => r.id === id)!
  }

  deleteRule(id: T.ID): void {
    this.db.run('DELETE FROM rules WHERE id = ?', [id])
    this.rulesCache = null
    this.cur = null
    this.finishRuleEntry()
    this.notify('meta')
  }

  /** Re-applies category rules (and fills missing task links) to recent sessions. */
  reapplyRules(sinceMs?: number): number {
    const since = sinceMs ?? this.now() - 30 * DAY
    let changed = 0
    transaction(this.db, () => {
      for (const s of this.db.all('SELECT id, app_id, title, category_id, task_id FROM activity_sessions WHERE end_ms > ?', [since])) {
        const m = this.matchRules(s.app_id, s.title)
        if (m.categoryId !== s.category_id || (m.taskId != null && s.task_id == null)) {
          this.db.run('UPDATE activity_sessions SET category_id = ?, task_id = COALESCE(task_id, ?) WHERE id = ?', [
            m.categoryId, m.taskId, s.id
          ])
          changed++
        }
      }
    })
    if (changed) this.notify('activity')
    return changed
  }

  private matchRules(appId: T.ID, title: string): { taskId: T.ID | null; categoryId: T.ID | null } {
    let taskId: T.ID | null = null
    let categoryId: T.ID | null = null
    for (const r of this.rules()) {
      if (r.appId != null && r.appId !== appId) continue
      if (!patternMatches(r.titlePattern, title)) continue
      taskId ??= r.taskId
      categoryId ??= r.categoryId
    }
    return { taskId, categoryId }
  }

  // --------------------------------------------------------------------- stats

  getUsage(from: number, to: number): T.UsageSummary {
    const byApp = new Map<T.ID, number>()
    const byCategory = new Map<T.ID, number>()
    const byTitle = new Map<string, { appId: T.ID; title: string; ms: number }>()
    let activeMs = 0
    let firstActivity: number | null = null
    let lastActivity: number | null = null
    for (const s of this.listSessions(from, to)) {
      const ms = clipDuration(s.start, s.end, from, to)
      if (ms <= 0) continue
      activeMs += ms
      bump(byApp, s.appId, ms)
      bump(byCategory, s.categoryId, ms)
      if (s.title) {
        const key = `${s.appId} ${s.title}`
        const item = byTitle.get(key) ?? { appId: s.appId, title: s.title, ms: 0 }
        item.ms += ms
        byTitle.set(key, item)
      }
      const start = Math.max(s.start, from)
      const end = Math.min(s.end, to)
      firstActivity = firstActivity == null ? start : Math.min(firstActivity, start)
      lastActivity = lastActivity == null ? end : Math.max(lastActivity, end)
    }
    const now = this.now()
    const taskMs = this.listTimeEntries({ from, to }).reduce((sum, e) => sum + clipDuration(e.start, e.end ?? now, from, to), 0)
    const tasksClosed = this.db.get(
      `SELECT COUNT(*) AS n FROM tasks WHERE status = 'closed' AND closed_at >= ? AND closed_at < ?`,
      [from, to]
    )!.n as number
    return {
      from, to, activeMs, firstActivity, lastActivity,
      byApp: sortedItems(byApp),
      byCategory: sortedItems(byCategory),
      byTitle: [...byTitle.values()].sort((a, b) => b.ms - a.ms).slice(0, 30),
      taskMs, tasksClosed
    }
  }

  /** Active (foreground, non-idle) milliseconds per local day; sessions are split at midnight. */
  getDailyActive(fromKey: string, toKey: string): T.DayValue[] {
    const from = startOfDayMs(fromKey)
    const to = endOfDayMs(toKey)
    const totals = new Map<string, number>()
    const rows = this.db.all(
      `SELECT s.start_ms AS s, s.end_ms AS e FROM activity_sessions s JOIN apps a ON a.id = s.app_id
       WHERE a.ignored = 0 AND s.end_ms > ? AND s.start_ms < ?`,
      [from, to]
    )
    for (const r of rows) {
      let start = Math.max(r.s as number, from)
      const end = Math.min(r.e as number, to)
      while (start < end) {
        const key = dayKey(start)
        const chunkEnd = Math.min(end, endOfDayMs(key))
        bump(totals, key, chunkEnd - start)
        start = chunkEnd
      }
    }
    return eachDay(fromKey, toKey, (key) => totals.get(key) ?? 0)
  }

  getHeatmap(metric: T.HeatmapMetric, fromKey: string, toKey: string): T.DayValue[] {
    if (metric === 'active') return this.getDailyActive(fromKey, toKey)
    const counts = new Map<string, number>()
    const rows = this.db.all(`SELECT closed_at AS c FROM tasks WHERE status = 'closed' AND closed_at >= ? AND closed_at < ?`, [
      startOfDayMs(fromKey),
      endOfDayMs(toKey)
    ])
    for (const r of rows) bump(counts, dayKey(r.c as number), 1)
    return eachDay(fromKey, toKey, (key) => counts.get(key) ?? 0)
  }

  /** GitHub-style activity feed for the last `days` days, newest first. */
  getFeed(days = 14): T.FeedEvent[] {
    const now = this.now()
    const from = startOfDayMs(addDays(todayKey(now), -(days - 1)))
    const events: T.FeedEvent[] = []

    for (const r of this.db.all('SELECT id, number, title, created_at FROM tasks WHERE created_at >= ?', [from])) {
      events.push({ kind: 'task_created', at: r.created_at, taskId: r.id, number: r.number, title: r.title })
    }
    for (const r of this.db.all(`SELECT id, number, title, closed_at FROM tasks WHERE status = 'closed' AND closed_at >= ?`, [from])) {
      events.push({ kind: 'task_closed', at: r.closed_at, taskId: r.id, number: r.number, title: r.title })
    }

    const logged = new Map<string, Extract<T.FeedEvent, { kind: 'time_logged' }>>()
    for (const e of this.listTimeEntries({ from })) {
      if (e.end == null) continue
      const key = `${e.taskId}|${dayKey(e.end)}`
      const item = logged.get(key) ?? { kind: 'time_logged', at: e.end, taskId: e.taskId, number: e.taskNumber, title: e.taskTitle, ms: 0 }
      item.ms += e.end - e.start
      item.at = Math.max(item.at, e.end)
      logged.set(key, item)
    }
    events.push(...[...logged.values()].filter((e) => e.ms >= MINUTE))

    const perDay = new Map<string, { total: number; last: number; apps: Map<T.ID, number> }>()
    for (const s of this.listSessions(from, now)) {
      const key = dayKey(s.start)
      const day = perDay.get(key) ?? { total: 0, last: 0, apps: new Map<T.ID, number>() }
      day.total += s.end - s.start
      day.last = Math.max(day.last, s.end)
      bump(day.apps, s.appId, s.end - s.start)
      perDay.set(key, day)
    }
    for (const [date, day] of perDay) {
      if (day.total < MINUTE) continue
      const [top] = sortedItems(day.apps)
      events.push({ kind: 'day_summary', at: day.last, date, activeMs: day.total, topAppId: top?.id ?? null, topAppMs: top?.ms ?? 0 })
    }
    return events.sort((a, b) => b.at - a.at)
  }

  // -------------------------------------------------------------------- export

  exportJson(): string {
    const tables: Record<string, Row[]> = {}
    const names = ['settings', 'projects', 'labels', 'tasks', 'task_labels', 'time_entries', 'recurrences', 'categories', 'rules', 'activity_sessions']
    for (const name of names) tables[name] = this.db.all(`SELECT * FROM ${name}`)
    tables.apps = this.db.all('SELECT id, exe_path, exe_name, display_name, category_id, record_titles, ignored, is_game, first_seen FROM apps')
    return JSON.stringify({ app: 'timehub', format: 1, exportedAt: new Date(this.now()).toISOString(), tables }, null, 2)
  }

  /** One timeline CSV with both task time and app activity (UTF-8 with BOM for Excel). */
  exportCsv(): string {
    const esc = (v: unknown): string => {
      const s = v == null ? '' : String(v)
      return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const iso = (ms: number): string => new Date(ms).toISOString()
    const minutes = (ms: number): string => (ms / MINUTE).toFixed(1)
    const apps = new Map(this.listApps().map((a) => [a.id, a.displayName]))
    const categories = new Map(this.listCategories().map((c) => [c.id, c.name]))
    const rows: { start: number; cells: unknown[] }[] = []
    const now = this.now()
    for (const e of this.listTimeEntries()) {
      const end = e.end ?? now
      rows.push({ start: e.start, cells: ['task', iso(e.start), iso(end), minutes(end - e.start), `#${e.taskNumber} ${e.taskTitle}`, e.note || e.source, ''] })
    }
    for (const s of this.listSessions(0, Number.MAX_SAFE_INTEGER)) {
      rows.push({ start: s.start, cells: ['activity', iso(s.start), iso(s.end), minutes(s.end - s.start), apps.get(s.appId), s.title, categories.get(s.categoryId)] })
    }
    rows.sort((a, b) => a.start - b.start)
    const header = ['type', 'start', 'end', 'minutes', 'app_or_task', 'title_or_note', 'category']
    return '﻿' + [header, ...rows.map((r) => r.cells)].map((cells) => cells.map(esc).join(',')).join('\r\n')
  }

  // ---------------------------------------------------------------------- seed

  private seed(language: T.Lang): void {
    transaction(this.db, () => {
      for (const c of DEFAULT_CATEGORIES) {
        this.db.run('INSERT INTO categories (key, name, color) VALUES (?, ?, ?)', [c.key, c.name, c.color])
      }
      for (const l of DEFAULT_LABELS[language]) this.db.run('INSERT INTO labels (name, color) VALUES (?, ?)', [l.name, l.color])
      for (const [key, value] of Object.entries(defaultSettings(language))) this.writeSetting(key, value)
    })
  }
}

function validateSpan(start: number, end: number): void {
  if (!(end > start)) throw new Error('End must be after start')
  if (end - start > DAY) throw new Error('A time entry cannot be longer than 24 hours')
}
