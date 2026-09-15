import { transaction, type Row, type SqlDb, type SqlValue } from './sql'
import { migrate } from './migrations'
import type * as T from './types'
import { DAY, MINUTE, addDays, clipDuration, dayKey, endOfDayMs, startOfDayMs, todayKey, weekday } from './time'
import { computeStreak, occursOn } from './recurrence'
import { currentStreak, longestStreak } from './streak'
import { editorProject, isCodeEditor } from './projects'
import { DEFAULT_CATEGORIES, DEFAULT_LABELS, guessCategoryKey, looksLikeGame, prettifyExeName } from './catalog'
import { detectSite, isBrowserExe } from './sites'
import { parseChat } from './social'

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
  /** Category for a new app when it's known up front (sites split out of a browser) */
  categoryKey?: import('./catalog').CategoryKey
}

export interface SampleOptions {
  intervalMs: number
  idleThresholdMs: number
}

export type SampleResult =
  | { state: 'idle' }
  | { state: 'ignored'; app: T.AppInfo }
  | { state: 'active'; app: T.AppInfo; title: string; since: number; created: boolean }

/** What a media player reports (Windows media sessions). */
export interface MediaSample {
  at: number
  source: string
  title: string
  artist: string
  album: string
  playing: boolean
  /** Defaults to music */
  kind?: T.MediaKind
}

export interface IntegrationRow {
  enabled: boolean
  config: Record<string, unknown>
  state: Record<string, unknown>
  updatedAt: number
}

interface Target {
  taskId: T.ID | null
  goalId: T.ID | null
}
interface OpenSpan {
  id: T.ID
  start: number
  end: number
}
interface OpenSession extends OpenSpan {
  appId: T.ID
  title: string
  ruleTarget: Target | null
}
interface OpenRuleEntry extends OpenSpan, Target {}
interface OpenMedia extends OpenSpan {
  source: string
  title: string
  artist: string
  album: string
  kind: T.MediaKind
}

const MIN_SPAN_MS = 1000
const MIN_MEDIA_MS = 5000
/** Fragments of the same track closer than this (pause, buffering, seeking) are one listen. */
const LISTEN_GAP_MS = 5 * MINUTE

/** Ids of the rows that start a new listen; the rest continue the same track after a short break. */
function listenStarts(rows: { id: T.ID; title: string; artist: string; start: number; end: number }[]): Set<T.ID> {
  const lastEnd = new Map<string, number>()
  const starts = new Set<T.ID>()
  for (const r of [...rows].sort((a, b) => a.start - b.start)) {
    const key = `${r.title}\u0000${r.artist}`
    const prev = lastEnd.get(key)
    if (prev == null || r.start - prev > LISTEN_GAP_MS) starts.add(r.id)
    lastEnd.set(key, Math.max(prev ?? 0, r.end))
  }
  return starts
}
const MAX_TITLE_LENGTH = 300
/** A day counts toward an app/game streak after this much use. */
const STREAK_MIN_MS = 5 * MINUTE
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

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
    weekStartsOn: language === 'ru' ? 1 : 0,
    reminders: true,
    remindBeforeMin: 5,
    musicFolders: [],
    visualizer: true,
    visualizerPalette: 'sunset'
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
const clampPercent = (n: number): number => Math.min(100, Math.max(0, Math.round(n)))
const sameTarget = (a: Target | null, b: Target | null): boolean =>
  (a?.taskId ?? null) === (b?.taskId ?? null) && (a?.goalId ?? null) === (b?.goalId ?? null)

function required(value: string, what: string): string {
  const v = value.trim()
  if (!v) throw new Error(`${what} is required`)
  return v
}

function normalizeTime(v: string | null | undefined): string | null {
  if (v == null || v === '') return null
  if (!TIME_RE.test(v)) throw new Error('Time must look like HH:MM')
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

/** Adds each [start, end) span to the local days it covers, clipped to [from, to). */
function spreadByDay(spans: { s: number; e: number }[], from: number, to: number): Map<string, number> {
  const totals = new Map<string, number>()
  for (const span of spans) {
    let start = Math.max(span.s, from)
    const end = Math.min(span.e, to)
    while (start < end) {
      const key = dayKey(start)
      const chunkEnd = Math.min(end, endOfDayMs(key))
      bump(totals, key, chunkEnd - start)
      start = chunkEnd
    }
  }
  return totals
}

const toProject = (r: Row): T.Project => ({
  id: r.id, name: r.name, color: r.color, description: r.description, archived: bool(r.archived), createdAt: r.created_at
})
const toLabel = (r: Row): T.Label => ({ id: r.id, name: r.name, color: r.color, description: r.description })
const toTask = (r: Row): T.Task => ({
  id: r.id, number: r.number, title: r.title, body: r.body, status: r.status, priority: r.priority,
  projectId: r.project_id, labelIds: idList(r.label_ids), dueDate: r.due_date, plannedDate: r.planned_date,
  plannedTime: r.planned_time ?? null, estimateMin: r.estimate_min, recurrenceId: r.recurrence_id,
  parentId: r.parent_id ?? null, goalId: r.goal_id ?? null, progress: r.progress ?? null,
  childCount: r.child_count ?? 0, childDone: r.child_done ?? 0, streak: 0, sortOrder: r.sort_order,
  createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, trackedMs: r.tracked_ms ?? 0
})
const toEntry = (r: Row): T.TimeEntry => ({
  id: r.id, taskId: r.task_id ?? null, goalId: r.goal_id ?? null, taskNumber: r.task_number ?? null,
  title: r.title ?? '', start: r.start_ms, end: r.end_ms, source: r.source, note: r.note
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
  id: r.id, appId: r.app_id, titlePattern: r.title_pattern, taskId: r.task_id, goalId: r.goal_id ?? null,
  categoryId: r.category_id, createdAt: r.created_at
})
const toNote = (r: Row): T.GoalNote => ({ id: r.id, goalId: r.goal_id, body: r.body, progress: r.progress ?? null, createdAt: r.created_at })
const toLink = (r: Row): T.AppLink => ({
  appId: r.app_id, provider: r.provider, externalId: r.external_id, name: r.name ?? null, imageUrl: r.image_url ?? null, storeUrl: r.store_url ?? null
})
const toMedia = (r: Row): T.MediaSession => ({
  id: r.id, source: r.source, title: r.title, artist: r.artist, album: r.album, start: r.start_ms, end: r.end_ms
})
const toEvent = (r: Row): T.CalendarEvent => ({
  id: r.id, source: r.source, uid: r.uid, title: r.title, location: r.location, start: r.start_ms, end: r.end_ms,
  allDay: bool(r.all_day), color: r.color
})
function toRecurrence(r: Row): Omit<T.Recurrence, 'streak' | 'doneTotal'> {
  return {
    id: r.id, title: r.title, body: r.body, rule: r.rule, daysMask: r.days_mask, dayOfMonth: r.day_of_month,
    timeOfDay: r.time_of_day ?? null, completeOnTarget: bool(r.complete_on_target), projectId: r.project_id,
    goalId: r.goal_id ?? null, labelIds: idList(r.label_ids), estimateMin: r.estimate_min, active: bool(r.active),
    startDate: r.start_date, lastGenerated: r.last_generated, createdAt: r.created_at
  }
}
function toGoal(r: Row, streak: number): T.Goal {
  const taskCount = (r.task_count as number) ?? 0
  const taskDone = (r.task_done as number) ?? 0
  const autoProgress = bool(r.auto_progress)
  const progress =
    r.status === 'achieved' ? 100 : autoProgress && taskCount > 0 ? Math.round((taskDone / taskCount) * 100) : (r.progress as number)
  return {
    id: r.id, title: r.title, body: r.body, emoji: r.emoji, color: r.color, status: r.status, progress,
    manualProgress: r.progress, autoProgress, targetDate: r.target_date, createdAt: r.created_at, updatedAt: r.updated_at,
    achievedAt: r.achieved_at, trackedMs: r.tracked_ms ?? 0, taskCount, taskDone, streak, lastWorkedAt: r.last_worked ?? null
  }
}

const toLibrary = (r: Row): T.LibraryItem => ({
  id: r.id, kind: r.kind, title: r.title, originalTitle: r.original_title, coverUrl: r.cover_url ?? null, status: r.status,
  favorite: bool(r.favorite), progress: r.progress, total: r.total ?? null, latest: r.latest ?? null, rating: r.rating ?? null,
  notes: r.notes, year: r.year ?? null, format: r.format, source: r.source, externalId: r.external_id ?? null, url: r.url ?? null,
  appId: r.app_id ?? null, statusAuto: bool(r.status_auto), createdAt: r.created_at, updatedAt: r.updated_at,
  startedAt: r.started_at ?? null, finishedAt: r.finished_at ?? null, trackedMs: r.tracked_ms ?? 0, lastActivityAt: r.last_activity ?? null
})

const CALL_SELECT = `SELECT c.*, a.icon AS icon, a.display_name AS display_name FROM calls c LEFT JOIN apps a ON a.id = c.app_id`

const toCall = (r: Row): T.CallInfo => ({
  id: r.id as T.ID,
  appId: (r.app_id as T.ID | null) ?? null,
  app: String(r.display_name ?? r.app_name),
  icon: (r.icon as string | null) ?? null,
  context: String(r.context ?? ''),
  start: Number(r.start_ms),
  end: Number(r.end_ms)
})

const LIBRARY_SELECT = `SELECT l.*,
  (SELECT COALESCE(SUM(s.end_ms - s.start_ms), 0) FROM activity_sessions s WHERE s.app_id = l.app_id) AS tracked_ms,
  (SELECT MAX(s.end_ms) FROM activity_sessions s WHERE s.app_id = l.app_id) AS last_activity
  FROM library_items l`

// The first `?` is "now", used as the end of a running timer.
const TASK_SELECT = `SELECT t.*,
  (SELECT group_concat(label_id) FROM task_labels tl WHERE tl.task_id = t.id) AS label_ids,
  (SELECT COALESCE(SUM(COALESCE(e.end_ms, ?) - e.start_ms), 0) FROM time_entries e WHERE e.task_id = t.id) AS tracked_ms,
  (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id) AS child_count,
  (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.status = 'closed') AS child_done
  FROM tasks t`

const ENTRY_SELECT = `SELECT e.*, t.number AS task_number, COALESCE(t.title, g.title) AS title
  FROM time_entries e LEFT JOIN tasks t ON t.id = e.task_id LEFT JOIN goals g ON g.id = e.goal_id`

const SESSION_SELECT = `SELECT s.id, s.app_id, s.title, s.start_ms, s.end_ms, s.task_id,
  COALESCE(s.category_id, a.category_id, (SELECT id FROM categories WHERE key = 'other')) AS category_id
  FROM activity_sessions s JOIN apps a ON a.id = s.app_id`

// Both `?` are "now" (running timers).
const GOAL_SELECT = `SELECT g.*,
  (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id) AS task_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status = 'closed') AS task_done,
  (SELECT COALESCE(SUM(COALESCE(e.end_ms, ?) - e.start_ms), 0) FROM time_entries e
     WHERE e.goal_id = g.id OR e.task_id IN (SELECT id FROM tasks WHERE goal_id = g.id)) AS tracked_ms,
  (SELECT MAX(COALESCE(e.end_ms, ?)) FROM time_entries e
     WHERE e.goal_id = g.id OR e.task_id IN (SELECT id FROM tasks WHERE goal_id = g.id)) AS last_worked
  FROM goals g`

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
  private media: OpenMedia | null = null

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

  listTasks(filter: { status?: T.TaskStatus; parentId?: T.ID; goalId?: T.ID } = {}): T.Task[] {
    const where: string[] = []
    const params: SqlValue[] = [this.now()]
    if (filter.status) {
      where.push('t.status = ?')
      params.push(filter.status)
    }
    if (filter.parentId != null) {
      where.push('t.parent_id = ?')
      params.push(filter.parentId)
    }
    if (filter.goalId != null) {
      where.push('t.goal_id = ?')
      params.push(filter.goalId)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return this.withStreaks(this.db.all(`${TASK_SELECT} ${clause} ORDER BY t.number DESC`, params).map(toTask))
  }

  getTask(id: T.ID): T.Task | null {
    const row = this.db.get(`${TASK_SELECT} WHERE t.id = ?`, [this.now(), id])
    return row ? this.withStreaks([toTask(row)])[0] : null
  }

  getTaskByNumber(number: number): T.Task | null {
    const row = this.db.get(`${TASK_SELECT} WHERE t.number = ?`, [this.now(), number])
    return row ? this.withStreaks([toTask(row)])[0] : null
  }

  createTask(input: T.TaskInput): T.Task {
    const id = this.insertTask(input, null)
    this.notify('tasks')
    if (input.goalId != null || input.parentId != null) this.notify('goals')
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
    if (patch.plannedTime !== undefined) set('planned_time', normalizeTime(patch.plannedTime))
    if (patch.estimateMin !== undefined) set('estimate_min', patch.estimateMin)
    if (patch.goalId !== undefined) set('goal_id', patch.goalId)
    if (patch.progress !== undefined) set('progress', patch.progress == null ? null : clampPercent(patch.progress))
    if (patch.parentId !== undefined) {
      if (patch.parentId != null) this.assertNoCycle(id, patch.parentId)
      set('parent_id', patch.parentId)
    }
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
      if (closing) timerStopped = this.closeRunningEntries(now, { taskId: id })
    })
    this.notify('tasks')
    this.notify('goals')
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
    this.notify('goals')
  }

  /** Persists a manual ordering (e.g. drag & drop on the Today page). */
  reorderTasks(ids: T.ID[]): void {
    transaction(this.db, () => {
      ids.forEach((id, i) => this.db.run('UPDATE tasks SET sort_order = ? WHERE id = ?', [i + 1, id]))
    })
    this.notify('tasks')
  }

  private withStreaks(tasks: T.Task[]): T.Task[] {
    if (!tasks.some((t) => t.recurrenceId != null)) return tasks
    const streaks = new Map(this.listRecurrences().map((r) => [r.id, r.streak]))
    for (const t of tasks) if (t.recurrenceId != null) t.streak = streaks.get(t.recurrenceId) ?? 0
    return tasks
  }

  private assertNoCycle(taskId: T.ID, parentId: T.ID): void {
    let cursor: T.ID | null = parentId
    for (let i = 0; cursor != null && i < 1000; i++) {
      if (cursor === taskId) throw new Error('A task cannot be a subtask of itself')
      cursor = (this.db.get('SELECT parent_id FROM tasks WHERE id = ?', [cursor])?.parent_id as T.ID | null) ?? null
    }
  }

  private insertTask(input: T.TaskInput, recurrenceId: T.ID | null): T.ID {
    const title = required(input.title, 'Title')
    const now = this.now()
    return transaction(this.db, () => {
      // Subtasks inherit the parent's goal and project unless given explicitly.
      const parent = input.parentId != null ? this.db.get('SELECT goal_id, project_id FROM tasks WHERE id = ?', [input.parentId]) : undefined
      if (input.parentId != null && !parent) throw new Error('Parent task not found')
      const goalId = input.goalId !== undefined ? input.goalId : (parent?.goal_id ?? null)
      const projectId = input.projectId !== undefined ? input.projectId : (parent?.project_id ?? null)
      const maxNumber = this.db.get('SELECT COALESCE(MAX(number), 0) AS n FROM tasks')!.n as number
      const number = Math.max(maxNumber, Number(this.readSetting('_taskSeq') ?? 0)) + 1
      this.writeSetting('_taskSeq', number)
      const sort = this.db.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS s FROM tasks')!.s as number
      const { lastId } = this.db.run(
        `INSERT INTO tasks (number, title, body, status, priority, project_id, due_date, planned_date, planned_time,
          estimate_min, recurrence_id, parent_id, goal_id, progress, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          number, title, input.body ?? '', input.priority ?? 0, projectId, input.dueDate ?? null, input.plannedDate ?? null,
          normalizeTime(input.plannedTime), input.estimateMin ?? null, recurrenceId, input.parentId ?? null, goalId,
          input.progress == null ? null : clampPercent(input.progress), sort, now, now
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

  listTimeEntries(q: { taskId?: T.ID; goalId?: T.ID; withGoalTasks?: boolean; from?: number; to?: number } = {}): T.TimeEntry[] {
    const where: string[] = []
    const params: SqlValue[] = []
    if (q.taskId != null) {
      where.push('e.task_id = ?')
      params.push(q.taskId)
    }
    if (q.goalId != null) {
      if (q.withGoalTasks) {
        where.push('(e.goal_id = ? OR e.task_id IN (SELECT id FROM tasks WHERE goal_id = ?))')
        params.push(q.goalId, q.goalId)
      } else {
        where.push('e.goal_id = ?')
        params.push(q.goalId)
      }
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
    return r
      ? { entryId: r.id, taskId: r.task_id ?? null, goalId: r.goal_id ?? null, taskNumber: r.task_number ?? null, title: r.title ?? '', start: r.start_ms }
      : null
  }

  /** Starts a timer on the task; any running timer is stopped first. */
  startTimer(taskId: T.ID): T.RunningTimer {
    return this.startTimerFor({ taskId, goalId: null })
  }

  /** Starts a timer on a goal itself ("I'm working on this goal now"). */
  startGoalTimer(goalId: T.ID): T.RunningTimer {
    return this.startTimerFor({ taskId: null, goalId })
  }

  private startTimerFor(target: Target): T.RunningTimer {
    const now = this.now()
    transaction(this.db, () => {
      this.closeRunningEntries(now)
      this.finishRuleEntry()
      this.db.run(`INSERT INTO time_entries (task_id, goal_id, start_ms, end_ms, source, note) VALUES (?, ?, ?, NULL, 'timer', '')`, [
        target.taskId,
        target.goalId,
        now
      ])
    })
    this.checkTargets()
    this.notify('time')
    this.notify('tasks')
    this.notify('goals')
    return this.getRunningTimer()!
  }

  stopTimer(): void {
    if (this.closeRunningEntries(this.now())) {
      this.checkTargets()
      this.notify('time')
      this.notify('tasks')
      this.notify('goals')
    }
  }

  private closeRunningEntries(at: number, target: Partial<Target> = {}): boolean {
    const where = ['end_ms IS NULL']
    const params: SqlValue[] = [at]
    if (target.taskId != null) {
      where.push('task_id = ?')
      params.push(target.taskId)
    }
    if (target.goalId != null) {
      where.push('goal_id = ?')
      params.push(target.goalId)
    }
    const { changes } = this.db.run(`UPDATE time_entries SET end_ms = MAX(start_ms, ?) WHERE ${where.join(' AND ')}`, params)
    // A start/stop misclick shouldn't leave a zero-length entry behind.
    this.db.run(`DELETE FROM time_entries WHERE source = 'timer' AND end_ms IS NOT NULL AND end_ms - start_ms < ? AND start_ms > ?`, [
      MIN_SPAN_MS,
      at - MIN_SPAN_MS
    ])
    return changes > 0
  }

  addTimeEntry(input: T.TimeEntryInput): T.TimeEntry {
    validateSpan(input.start, input.end)
    const taskId = input.taskId ?? null
    const goalId = input.goalId ?? null
    if ((taskId == null) === (goalId == null)) throw new Error('A time entry belongs to exactly one task or goal')
    const { lastId } = this.db.run(
      `INSERT INTO time_entries (task_id, goal_id, start_ms, end_ms, source, note) VALUES (?, ?, ?, ?, 'manual', ?)`,
      [taskId, goalId, input.start, input.end, input.note?.trim() ?? '']
    )
    this.checkTargets()
    this.notify('time')
    this.notify('tasks')
    this.notify('goals')
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
    this.checkTargets()
    this.notify('time')
    this.notify('tasks')
    this.notify('goals')
    return toEntry(this.db.get(`${ENTRY_SELECT} WHERE e.id = ?`, [id])!)
  }

  deleteTimeEntry(id: T.ID): void {
    this.db.run('DELETE FROM time_entries WHERE id = ?', [id])
    if (this.ruleEntry?.id === id) this.ruleEntry = null
    this.notify('time')
    this.notify('tasks')
    this.notify('goals')
  }

  /**
   * Closes open instances of "complete on target" recurrences once their
   * estimate is tracked (a running timer counts, and gets stopped).
   */
  checkTargets(): number {
    const due = this.db.all(
      `SELECT t.id FROM tasks t JOIN recurrences r ON r.id = t.recurrence_id
       WHERE t.status = 'open' AND r.complete_on_target = 1 AND t.estimate_min > 0
         AND (SELECT COALESCE(SUM(COALESCE(e.end_ms, ?) - e.start_ms), 0) FROM time_entries e WHERE e.task_id = t.id)
             >= t.estimate_min * 60000`,
      [this.now()]
    )
    for (const r of due) this.updateTask(r.id, { status: 'closed' })
    return due.length
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
      title, input.body ?? '', input.rule, input.daysMask ?? 0, input.dayOfMonth ?? null, normalizeTime(input.timeOfDay),
      input.completeOnTarget ? 1 : 0, input.projectId ?? null, input.goalId ?? null, (input.labelIds ?? []).join(','),
      input.estimateMin ?? null, input.active === false ? 0 : 1
    ]
    let id = input.id
    if (id != null) {
      this.db.run(
        `UPDATE recurrences SET title = ?, body = ?, rule = ?, days_mask = ?, day_of_month = ?, time_of_day = ?,
          complete_on_target = ?, project_id = ?, goal_id = ?, label_ids = ?, estimate_min = ?, active = ?,
          start_date = COALESCE(?, start_date) WHERE id = ?`,
        [...values, input.startDate ?? null, id]
      )
    } else {
      id = this.db.run(
        `INSERT INTO recurrences (title, body, rule, days_mask, day_of_month, time_of_day, complete_on_target, project_id,
          goal_id, label_ids, estimate_min, active, start_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            {
              title: rec.title, body: rec.body, projectId: rec.projectId, goalId: rec.goalId, labelIds: rec.labelIds,
              estimateMin: rec.estimateMin, plannedDate: today, plannedTime: rec.timeOfDay
            },
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

  // --------------------------------------------------------------------- goals

  listGoals(): T.Goal[] {
    const now = this.now()
    const streaks = this.goalStreaks()
    return this.db
      .all(`${GOAL_SELECT} ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'achieved' THEN 1 ELSE 2 END, g.created_at DESC`, [now, now])
      .map((r) => toGoal(r, streaks.get(r.id) ?? 0))
  }

  getGoal(id: T.ID): T.Goal | null {
    const now = this.now()
    const row = this.db.get(`${GOAL_SELECT} WHERE g.id = ?`, [now, now, id])
    return row ? toGoal(row, this.goalStreaks(id).get(id) ?? 0) : null
  }

  saveGoal(input: T.GoalInput): T.Goal {
    const now = this.now()
    const title = required(input.title, 'Goal title')
    let id = input.id
    transaction(this.db, () => {
      if (id != null) {
        const current = this.db.get('SELECT * FROM goals WHERE id = ?', [id])
        if (!current) throw new Error('Goal not found')
        const status = input.status ?? current.status
        const achievedAt = status === 'achieved' ? (current.achieved_at ?? now) : null
        this.db.run(
          `UPDATE goals SET title = ?, body = ?, emoji = ?, color = ?, status = ?, progress = ?, auto_progress = ?,
            target_date = ?, updated_at = ?, achieved_at = ? WHERE id = ?`,
          [
            title, input.body ?? current.body, input.emoji ?? current.emoji, input.color ?? current.color, status,
            input.manualProgress != null ? clampPercent(input.manualProgress) : current.progress,
            input.autoProgress === undefined ? current.auto_progress : input.autoProgress ? 1 : 0,
            input.targetDate === undefined ? current.target_date : input.targetDate, now, achievedAt, id
          ]
        )
        if (status !== 'active') this.closeRunningEntries(now, { goalId: id })
      } else {
        id = this.db.run(
          `INSERT INTO goals (title, body, emoji, color, status, progress, auto_progress, target_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          [
            title, input.body ?? '', input.emoji || '🎯', input.color ?? '#1f883d', clampPercent(input.manualProgress ?? 0),
            input.autoProgress === false ? 0 : 1, input.targetDate ?? null, now, now
          ]
        ).lastId
      }
    })
    this.notify('goals')
    this.notify('time')
    return this.getGoal(id!)!
  }

  /** Deletes the goal, its journal and time logged on the goal itself; its tasks stay. */
  deleteGoal(id: T.ID): void {
    this.db.run('DELETE FROM goals WHERE id = ?', [id])
    this.rulesCache = null
    this.notify('goals')
    this.notify('tasks')
    this.notify('time')
  }

  listGoalNotes(goalId: T.ID): T.GoalNote[] {
    return this.db.all('SELECT * FROM goal_notes WHERE goal_id = ? ORDER BY created_at DESC', [goalId]).map(toNote)
  }

  /** Adds a journal entry; an optional progress value also updates the goal's manual progress. */
  addGoalNote(goalId: T.ID, body: string, progress?: number | null): T.GoalNote {
    const text = body.trim()
    if (!text && progress == null) throw new Error('Write something or set the progress')
    const now = this.now()
    const value = progress == null ? null : clampPercent(progress)
    const id = transaction(this.db, () => {
      if (value != null) this.db.run('UPDATE goals SET progress = ?, updated_at = ? WHERE id = ?', [value, now, goalId])
      return this.db.run('INSERT INTO goal_notes (goal_id, body, progress, created_at) VALUES (?, ?, ?, ?)', [goalId, text, value, now]).lastId
    })
    this.notify('goals')
    return toNote(this.db.get('SELECT * FROM goal_notes WHERE id = ?', [id])!)
  }

  deleteGoalNote(id: T.ID): void {
    this.db.run('DELETE FROM goal_notes WHERE id = ?', [id])
    this.notify('goals')
  }

  /** Time worked on a goal (and its tasks) per day. */
  getGoalDays(goalId: T.ID, fromKey: string, toKey: string): T.DayValue[] {
    const now = this.now()
    const from = startOfDayMs(fromKey)
    const to = endOfDayMs(toKey)
    const rows = this.db.all(
      `SELECT e.start_ms AS s, COALESCE(e.end_ms, ?) AS e FROM time_entries e LEFT JOIN tasks t ON t.id = e.task_id
       WHERE (e.goal_id = ? OR t.goal_id = ?) AND COALESCE(e.end_ms, ?) > ? AND e.start_ms < ?`,
      [now, goalId, goalId, now, from, to]
    ) as { s: number; e: number }[]
    const totals = spreadByDay(rows, from, to)
    return eachDay(fromKey, toKey, (key) => totals.get(key) ?? 0)
  }

  private goalStreaks(onlyGoal?: T.ID): Map<T.ID, number> {
    const since = startOfDayMs(addDays(todayKey(this.now()), -400))
    const rows = this.db.all(
      `SELECT COALESCE(e.goal_id, t.goal_id) AS gid, e.start_ms AS at FROM time_entries e LEFT JOIN tasks t ON t.id = e.task_id
         WHERE COALESCE(e.goal_id, t.goal_id) IS NOT NULL AND e.start_ms >= ?
       UNION ALL SELECT goal_id AS gid, created_at AS at FROM goal_notes WHERE created_at >= ?`,
      [since, since]
    )
    const days = new Map<T.ID, Set<string>>()
    for (const r of rows) {
      if (onlyGoal != null && r.gid !== onlyGoal) continue
      const set = days.get(r.gid) ?? new Set<string>()
      set.add(dayKey(r.at as number))
      days.set(r.gid, set)
    }
    const today = todayKey(this.now())
    return new Map([...days].map(([id, set]) => [id, currentStreak(set, today)]))
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

  ensureApp(
    exePath: string,
    exeName: string,
    displayName?: string,
    categoryKey?: import('./catalog').CategoryKey
  ): { app: T.AppInfo; created: boolean } {
    const path = exePath || exeName
    const key = path.toLowerCase()
    const cached = this.appCache.get(key)
    if (cached) return { app: cached, created: false }
    let row = this.db.get('SELECT * FROM apps WHERE exe_path = ?', [path])
    let created = false
    if (!row) {
      const isGame = looksLikeGame(exeName, exePath)
      const category = this.db.get('SELECT id FROM categories WHERE key = ?', [categoryKey ?? guessCategoryKey(exeName, isGame)])
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

  getAppLink(appId: T.ID): T.AppLink | null {
    const row = this.db.get('SELECT * FROM app_links WHERE app_id = ?', [appId])
    return row ? toLink(row) : null
  }

  /** Remembers which store/platform entry a tracked app is (Steam app, Roblox…). */
  setAppLink(link: T.AppLink): void {
    const current = this.getAppLink(link.appId)
    if (current && JSON.stringify(current) === JSON.stringify(link)) return
    this.db.run(
      `INSERT INTO app_links (app_id, provider, external_id, name, image_url, store_url) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(app_id) DO UPDATE SET provider = excluded.provider, external_id = excluded.external_id,
         name = excluded.name, image_url = excluded.image_url, store_url = excluded.store_url`,
      [link.appId, link.provider, link.externalId, link.name, link.imageUrl, link.storeUrl]
    )
    this.notify('meta')
  }

  /** Quick numbers for a running game's presence card. */
  getAppTotals(appId: T.ID): { totalMs: number; todayMs: number; streak: number } {
    const today = todayKey(this.now())
    const total = this.db.get('SELECT COALESCE(SUM(end_ms - start_ms), 0) AS ms FROM activity_sessions WHERE app_id = ?', [appId])!.ms as number
    const days = this.appDays(appId, addDays(today, -120))
    return { totalMs: total, todayMs: days.get(today) ?? 0, streak: currentStreak(this.streakDays(days), today) }
  }

  getAppStreaks(): T.AppStreak[] {
    const today = todayKey(this.now())
    const from = startOfDayMs(addDays(today, -120))
    const perApp = new Map<T.ID, Map<string, number>>()
    for (const r of this.db.all('SELECT app_id AS a, start_ms AS s, end_ms AS e FROM activity_sessions WHERE end_ms > ?', [from])) {
      const days = perApp.get(r.a) ?? new Map<string, number>()
      bump(days, dayKey(Math.max(r.s as number, from)), (r.e as number) - Math.max(r.s as number, from))
      perApp.set(r.a, days)
    }
    return [...perApp]
      .map(([appId, days]) => ({ appId, streak: currentStreak(this.streakDays(days), today) }))
      .filter((x) => x.streak > 0)
  }

  private appDays(appId: T.ID, fromKey: string): Map<string, number> {
    const from = startOfDayMs(fromKey)
    const rows = this.db.all('SELECT start_ms AS s, end_ms AS e FROM activity_sessions WHERE app_id = ? AND end_ms > ?', [appId, from]) as {
      s: number
      e: number
    }[]
    return spreadByDay(rows, from, Number.MAX_SAFE_INTEGER)
  }

  private streakDays(days: Map<string, number>): Set<string> {
    return new Set([...days].filter(([, ms]) => ms >= STREAK_MIN_MS).map(([d]) => d))
  }

  /** All-time report for one app. */
  getAppReport(appId: T.ID): T.AppReport {
    const row = this.db.get('SELECT * FROM apps WHERE id = ?', [appId])
    if (!row) throw new Error('App not found')
    const app = toApp(row)
    const today = todayKey(this.now())
    const spans = this.db.all('SELECT start_ms AS s, end_ms AS e FROM activity_sessions WHERE app_id = ? ORDER BY start_ms', [appId]) as {
      s: number
      e: number
    }[]
    const perDay = spreadByDay(spans, 0, Number.MAX_SAFE_INTEGER)
    const byHour = new Array<number>(24).fill(0)
    let totalMs = 0
    let longestRunMs = 0
    let runStart = 0
    let runEnd = -Infinity
    for (const { s, e } of spans) {
      totalMs += e - s
      if (s - runEnd > MINUTE) runStart = s
      runEnd = Math.max(runEnd, e)
      longestRunMs = Math.max(longestRunMs, runEnd - runStart)
      let t = s
      while (t < e) {
        const d = new Date(t)
        const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime()
        const chunkEnd = Math.min(e, next)
        byHour[d.getHours()] += chunkEnd - t
        t = chunkEnd
      }
    }
    const byWeekday = new Array<number>(7).fill(0)
    for (const [key, ms] of perDay) byWeekday[weekday(key)] += ms
    const months = new Map<string, number>()
    for (const [key, ms] of perDay) bump(months, key.slice(0, 7), ms)
    const monthly: T.MonthValue[] = []
    const anchor = new Date(this.now())
    for (let i = 11; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthly.push({ month, value: months.get(month) ?? 0 })
    }
    const titleRows = this.db.all(
      `SELECT title, SUM(end_ms - start_ms) AS ms FROM activity_sessions WHERE app_id = ? AND title != ''
       GROUP BY title ORDER BY ms DESC LIMIT 300`,
      [appId]
    )
    const projects = new Map<string, number>()
    if (isCodeEditor(app.exeName)) {
      for (const r of titleRows) {
        const name = editorProject(app.exeName, r.title)
        if (name) bump(projects, name, r.ms as number)
      }
    }
    const activeDaySet = [...perDay].filter(([, ms]) => ms >= MINUTE).map(([d]) => d)
    const streakSet = this.streakDays(perDay)
    return {
      app,
      link: this.getAppLink(appId),
      totalMs,
      sessions: spans.length,
      activeDays: activeDaySet.length,
      firstSeen: spans.length ? spans[0].s : null,
      lastUsed: spans.length ? Math.max(...spans.slice(-50).map((x) => x.e)) : null,
      longestRunMs,
      avgPerActiveDayMs: activeDaySet.length ? totalMs / activeDaySet.length : 0,
      streak: currentStreak(streakSet, today),
      bestStreak: longestStreak(streakSet),
      daily: eachDay(addDays(today, -370), today, (key) => perDay.get(key) ?? 0),
      monthly,
      byHour,
      byWeekday,
      topTitles: titleRows.slice(0, 30).map((r) => ({ title: r.title as string, ms: r.ms as number })),
      projects: [...projects].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms).slice(0, 20)
    }
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
    const { app, created } = this.ensureApp(s.exePath, s.exeName, s.displayName, s.categoryKey)
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
      const ruleTarget = match.taskId != null || match.goalId != null ? { taskId: match.taskId, goalId: match.goalId } : null
      const { lastId } = this.db.run(
        'INSERT INTO activity_sessions (app_id, title, start_ms, end_ms, task_id, category_id) VALUES (?, ?, ?, ?, ?, ?)',
        [app.id, title, s.at, s.at, timer?.taskId ?? match.taskId, match.categoryId]
      )
      this.cur = { id: lastId, appId: app.id, title, start: s.at, end: s.at, ruleTarget }
    }

    // A running timer wins over rule-based attribution, so time is never counted twice.
    this.trackRuleTime(timer ? null : (this.cur?.ruleTarget ?? null), s.at, maxGap)
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

  private trackRuleTime(target: Target | null, at: number, maxGap: number): void {
    const entry = this.ruleEntry
    const continuous = entry != null && at - entry.end <= maxGap
    if (entry && continuous && sameTarget(entry, target)) {
      this.extendSpan('time_entries', entry, at)
      if (entry.taskId != null) this.checkTargets()
      this.notify('time')
      return
    }
    if (entry) {
      if (continuous) this.extendSpan('time_entries', entry, at)
      this.finishRuleEntry()
    }
    if (target) {
      const { lastId } = this.db.run(
        `INSERT INTO time_entries (task_id, goal_id, start_ms, end_ms, source, note) VALUES (?, ?, ?, ?, 'rule', '')`,
        [target.taskId, target.goalId, at, at]
      )
      this.ruleEntry = { id: lastId, taskId: target.taskId, goalId: target.goalId, start: at, end: at }
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
    const goalId = input.goalId ?? null
    if (input.appId == null && !pattern) throw new Error('A rule needs an app or a title pattern')
    if (input.taskId == null && goalId == null && input.categoryId == null) throw new Error('A rule needs a task, goal or category')
    const values: SqlValue[] = [input.appId, pattern, input.taskId, goalId, input.categoryId]
    let id = input.id
    if (id != null) {
      this.db.run('UPDATE rules SET app_id = ?, title_pattern = ?, task_id = ?, goal_id = ?, category_id = ? WHERE id = ?', [...values, id])
    } else {
      id = this.db.run('INSERT INTO rules (app_id, title_pattern, task_id, goal_id, category_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
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

  private matchRules(appId: T.ID, title: string): { taskId: T.ID | null; goalId: T.ID | null; categoryId: T.ID | null } {
    let target: Target | null = null
    let categoryId: T.ID | null = null
    for (const r of this.rules()) {
      if (r.appId != null && r.appId !== appId) continue
      if (!patternMatches(r.titlePattern, title)) continue
      if (!target && (r.taskId != null || r.goalId != null)) target = { taskId: r.taskId, goalId: r.goalId }
      categoryId ??= r.categoryId
    }
    return { taskId: target?.taskId ?? null, goalId: target?.goalId ?? null, categoryId }
  }

  // --------------------------------------------------------------------- music

  /** Folds a media-player sample into the listening history (like activity sessions). */
  recordMedia(s: MediaSample, intervalMs: number): void {
    const maxGap = intervalMs * 2 + 2000
    const cur = this.media
    if (!s.playing || !s.title) {
      if (cur) this.finishMedia(cur, s.at, maxGap)
      this.media = null
      return
    }
    const kind = s.kind ?? 'music'
    const continuous = cur != null && s.at - cur.end <= maxGap
    if (cur && continuous && cur.source === s.source && cur.title === s.title && cur.artist === s.artist) {
      this.extendSpan('media_sessions', cur, s.at)
      // Some sites (Yandex Music) fill in the album a moment after the title — the same track becomes music.
      if (s.album && (!cur.album || cur.kind !== kind)) {
        this.db.run('UPDATE media_sessions SET album = ?, kind = ? WHERE id = ?', [s.album.slice(0, MAX_TITLE_LENGTH), kind, cur.id])
        cur.album = s.album
        cur.kind = kind
      }
    } else {
      if (cur) this.finishMedia(cur, s.at, maxGap)
      const { lastId } = this.db.run(
        'INSERT INTO media_sessions (source, title, artist, album, kind, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [s.source, s.title.slice(0, MAX_TITLE_LENGTH), s.artist.slice(0, MAX_TITLE_LENGTH), s.album.slice(0, MAX_TITLE_LENGTH), kind, s.at, s.at]
      )
      this.media = { id: lastId, source: s.source, title: s.title, artist: s.artist, album: s.album, kind, start: s.at, end: s.at }
    }
    this.notify('music')
  }

  closeMedia(at: number): void {
    if (this.media) this.finishMedia(this.media, at, 0)
    this.media = null
  }

  private finishMedia(cur: OpenMedia, at: number, maxGap: number): void {
    if (at - cur.end <= maxGap) this.extendSpan('media_sessions', cur, at)
    if (cur.end - cur.start < MIN_MEDIA_MS) this.db.run('DELETE FROM media_sessions WHERE id = ?', [cur.id])
    this.notify('music')
  }

  /** Inserts a finished listening session directly (demo data). */
  seedMedia(source: string, title: string, artist: string, album: string, start: number, end: number, kind: T.MediaKind = 'music'): void {
    this.db.run('INSERT INTO media_sessions (source, title, artist, album, kind, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      source, title, artist, album, kind, start, end
    ])
  }

  getMusic(from: number, to: number): T.MusicSummary {
    const rows = this.db.all("SELECT * FROM media_sessions WHERE kind = 'music' AND end_ms > ? AND start_ms < ? ORDER BY start_ms DESC", [from, to]).map(toMedia)
    const artists = new Map<string, { ms: number; plays: number }>()
    const tracks = new Map<string, { title: string; artist: string; ms: number; plays: number }>()
    const sources = new Map<string, number>()
    // A track cut into pieces by pauses or buffering is still one play.
    const starts = listenStarts(rows)
    let totalMs = 0
    for (const m of rows) {
      const ms = clipDuration(m.start, m.end, from, to)
      const play = starts.has(m.id) ? 1 : 0
      totalMs += ms
      if (m.artist) {
        const a = artists.get(m.artist) ?? { ms: 0, plays: 0 }
        a.ms += ms
        a.plays += play
        artists.set(m.artist, a)
      }
      const key = `${m.title}\u0000${m.artist}`
      const t = tracks.get(key) ?? { title: m.title, artist: m.artist, ms: 0, plays: 0 }
      t.ms += ms
      t.plays += play
      tracks.set(key, t)
      bump(sources, m.source, ms)
    }
    return {
      totalMs,
      plays: starts.size,
      topArtists: [...artists].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.ms - a.ms).slice(0, 10),
      topTracks: [...tracks.values()].sort((a, b) => b.ms - a.ms).slice(0, 10),
      bySource: [...sources].map(([source, ms]) => ({ source, ms })).sort((a, b) => b.ms - a.ms),
      recent: rows.slice(0, 20)
    }
  }

  // ------------------------------------------------------------------ calendar

  /** Replaces a calendar's events inside [from, to) with a fresh sync. */
  replaceCalendarEvents(source: string, from: number, to: number, events: Omit<T.CalendarEvent, 'id' | 'source'>[]): void {
    transaction(this.db, () => {
      this.db.run('DELETE FROM calendar_events WHERE source = ? AND start_ms < ? AND end_ms > ?', [source, to, from])
      for (const e of events) {
        this.db.run(
          'INSERT INTO calendar_events (source, uid, title, location, start_ms, end_ms, all_day, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [source, e.uid, e.title, e.location, e.start, e.end, e.allDay ? 1 : 0, e.color]
        )
      }
    })
    this.notify('calendar')
  }

  deleteCalendarSource(source: string): void {
    this.db.run('DELETE FROM calendar_events WHERE source = ?', [source])
    this.notify('calendar')
  }

  listCalendarEvents(from: number, to: number): T.CalendarEvent[] {
    return this.db.all('SELECT * FROM calendar_events WHERE end_ms > ? AND start_ms < ? ORDER BY all_day DESC, start_ms', [from, to]).map(toEvent)
  }

  // ------------------------------------------------------------------- library

  listLibrary(filter: { kind?: T.LibraryKind; status?: T.LibraryStatus; favorite?: boolean } = {}): T.LibraryItem[] {
    const where: string[] = []
    const params: SqlValue[] = []
    if (filter.kind) {
      where.push('l.kind = ?')
      params.push(filter.kind)
    }
    if (filter.status) {
      where.push('l.status = ?')
      params.push(filter.status)
    }
    if (filter.favorite) where.push('l.favorite = 1')
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return this.db.all(`${LIBRARY_SELECT} ${clause} ORDER BY l.updated_at DESC`, params).map(toLibrary)
  }

  getLibraryItem(id: T.ID): T.LibraryItem | null {
    const row = this.db.get(`${LIBRARY_SELECT} WHERE l.id = ?`, [id])
    return row ? toLibrary(row) : null
  }

  /**
   * Creates or edits a library item. Progress drives the status: starting a
   * planned item makes it active, reaching the total completes it. Changing
   * the status by hand stops automatic status updates for the item.
   */
  saveLibraryItem(input: T.LibraryInput): T.LibraryItem {
    const now = this.now()
    const title = required(input.title, 'Title')
    const current = input.id != null ? this.getLibraryItem(input.id) : null
    if (input.id != null && !current) throw new Error('Library item not found')
    const total = input.total === undefined ? (current?.total ?? null) : input.total == null ? null : Math.max(0, Math.round(input.total))
    let progress = Math.max(0, Math.round(input.progress ?? current?.progress ?? 0))
    if (total != null && total > 0) progress = Math.min(progress, total)
    const progressChanged = current ? progress !== current.progress : progress > 0
    let status: T.LibraryStatus = input.status ?? current?.status ?? 'planned'
    if (progressChanged && total && progress >= total && ['active', 'planned', 'rewatching'].includes(status)) status = 'completed'
    else if (progressChanged && progress > 0 && status === 'planned') status = 'active'
    const statusChangedByHand = current != null && input.status !== undefined && input.status !== current.status
    const statusAuto = input.statusAuto ?? (statusChangedByHand ? false : (current?.statusAuto ?? true))
    const rating = input.rating === undefined ? (current?.rating ?? null) : input.rating == null ? null : Math.min(10, Math.max(1, Math.round(input.rating)))
    const startedAt = current?.startedAt ?? (status === 'active' || status === 'completed' ? now : null)
    const finishedAt = status === 'completed' ? (current?.status === 'completed' ? current.finishedAt : now) : null
    const values: SqlValue[] = [
      input.kind, title, input.originalTitle ?? current?.originalTitle ?? '',
      input.coverUrl === undefined ? (current?.coverUrl ?? null) : input.coverUrl, status,
      (input.favorite ?? current?.favorite ?? false) ? 1 : 0, progress, total, rating, input.notes ?? current?.notes ?? '',
      input.year === undefined ? (current?.year ?? null) : input.year, input.format ?? current?.format ?? '',
      input.url === undefined ? (current?.url ?? null) : input.url, input.appId === undefined ? (current?.appId ?? null) : input.appId,
      statusAuto ? 1 : 0, now, startedAt, finishedAt
    ]
    let id = input.id
    if (current) {
      this.db.run(
        `UPDATE library_items SET kind = ?, title = ?, original_title = ?, cover_url = ?, status = ?, favorite = ?, progress = ?,
          total = ?, rating = ?, notes = ?, year = ?, format = ?, url = ?, app_id = ?, status_auto = ?, updated_at = ?,
          started_at = ?, finished_at = ? WHERE id = ?`,
        [...values, current.id]
      )
    } else {
      id = this.db.run(
        `INSERT INTO library_items (kind, title, original_title, cover_url, status, favorite, progress, total, rating, notes,
          year, format, url, app_id, status_auto, updated_at, started_at, finished_at, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
        [...values, now]
      ).lastId
    }
    this.notify('library')
    return this.getLibraryItem(id!)!
  }

  /** +1 episode / chapter (or −1); completes the item when it reaches the total. */
  bumpLibraryProgress(id: T.ID, delta = 1): T.LibraryItem {
    const item = this.getLibraryItem(id)
    if (!item) throw new Error('Library item not found')
    return this.saveLibraryItem({ id, kind: item.kind, title: item.title, progress: item.progress + delta })
  }

  deleteLibraryItem(id: T.ID): void {
    this.db.run('DELETE FROM library_items WHERE id = ?', [id])
    this.notify('library')
  }

  /**
   * Merges items from a connected service. Items whose status you changed by
   * hand keep your status; everything else follows the service.
   */
  importLibrary(
    source: T.LibrarySource,
    items: T.LibraryImport[],
    opts: { removeMissing?: boolean; kinds?: T.LibraryKind[] } = {}
  ): { added: number; updated: number; removed: number } {
    const now = this.now()
    let added = 0
    let updated = 0
    let removed = 0
    transaction(this.db, () => {
      for (const it of items) {
        const row = this.db.get('SELECT * FROM library_items WHERE source = ? AND external_id = ?', [source, it.externalId])
        const status = it.status
        const favorite = it.favorite ? 1 : 0
        const progress = Math.max(0, Math.round(it.progress ?? 0))
        if (!row) {
          this.db.run(
            `INSERT INTO library_items (kind, title, original_title, cover_url, status, favorite, progress, total, latest, rating,
              year, format, source, external_id, url, app_id, status_auto, created_at, updated_at, started_at, finished_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            [
              it.kind, it.title, it.originalTitle ?? '', it.coverUrl ?? null, status, favorite, progress, it.total ?? null,
              it.latest ?? null, it.rating ?? null, it.year ?? null, it.format ?? '', source, it.externalId, it.url ?? null,
              it.appId ?? null, now, now, status === 'active' || status === 'completed' ? now : null, status === 'completed' ? now : null
            ]
          )
          added++
          continue
        }
        const auto = bool(row.status_auto)
        const next = {
          kind: it.kind, title: it.title, original_title: it.originalTitle ?? row.original_title, cover_url: it.coverUrl ?? row.cover_url,
          total: it.total ?? row.total, latest: it.latest ?? row.latest, year: it.year ?? row.year, format: it.format ?? row.format,
          url: it.url ?? row.url, app_id: it.appId ?? row.app_id,
          // A status you set by hand sticks, but episodes/chapters keep coming from the service.
          status: auto ? status : row.status, favorite: auto ? favorite : row.favorite, progress: auto ? progress : Math.max(Number(row.progress), progress),
          rating: auto ? (it.rating ?? row.rating) : row.rating
        }
        const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => (next[k] ?? null) !== (row[k] ?? null))
        if (!changed) continue
        this.db.run(
          `UPDATE library_items SET kind = ?, title = ?, original_title = ?, cover_url = ?, total = ?, latest = ?, year = ?, format = ?,
            url = ?, app_id = ?, status = ?, favorite = ?, progress = ?, rating = ?, updated_at = ?,
            started_at = COALESCE(started_at, ?), finished_at = ? WHERE id = ?`,
          [
            next.kind, next.title, next.original_title, next.cover_url, next.total, next.latest, next.year, next.format, next.url,
            next.app_id, next.status, next.favorite, next.progress, next.rating, now,
            next.status === 'active' || next.status === 'completed' ? now : null,
            next.status === 'completed' ? (row.finished_at ?? now) : null, row.id
          ]
        )
        updated++
      }
      if (opts.removeMissing) {
        const keep = new Set(items.map((i) => i.externalId))
        const kinds = opts.kinds ? new Set<string>(opts.kinds) : null
        for (const r of this.db.all('SELECT id, external_id, kind FROM library_items WHERE source = ?', [source])) {
          if (keep.has(r.external_id) || (kinds && !kinds.has(r.kind))) continue
          this.db.run('DELETE FROM library_items WHERE id = ?', [r.id])
          removed++
        }
      }
    })
    if (added || updated || removed) this.notify('library')
    return { added, updated, removed }
  }

  /**
   * Keeps games in the library in step with the tracker: a game you played
   * in the last two weeks is "playing", one untouched for a month is "on hold".
   */
  refreshGamesInLibrary(): number {
    const now = this.now()
    const recent = now - 14 * DAY
    const stale = now - 30 * DAY
    const games = this.db.all(
      `SELECT a.id, a.display_name, k.provider, k.external_id, k.name AS link_name, k.image_url,
         (SELECT MAX(s.end_ms) FROM activity_sessions s WHERE s.app_id = a.id) AS last
       FROM apps a LEFT JOIN app_links k ON k.app_id = a.id WHERE a.is_game = 1 AND a.ignored = 0`
    )
    let changed = 0
    transaction(this.db, () => {
      for (const g of games) {
        if (g.last == null) continue
        let item = this.db.get('SELECT * FROM library_items WHERE app_id = ? LIMIT 1', [g.id])
        if (!item && g.provider === 'steam') {
          item = this.db.get(`SELECT * FROM library_items WHERE source = 'steam' AND external_id = ?`, [g.external_id])
        }
        if (!item) {
          const status: T.LibraryStatus = g.last >= recent ? 'active' : 'on_hold'
          this.db.run(
            `INSERT INTO library_items (kind, title, cover_url, status, source, external_id, app_id, status_auto, created_at, updated_at, started_at)
             VALUES ('game', ?, ?, ?, 'tracker', ?, ?, 1, ?, ?, ?)`,
            [g.link_name ?? g.display_name, g.image_url ?? null, status, String(g.id), g.id, now, now, now]
          )
          changed++
          continue
        }
        let status: string = item.status
        if (bool(item.status_auto)) {
          if (g.last >= recent && ['planned', 'on_hold', 'dropped'].includes(status)) status = 'active'
          else if (g.last < stale && status === 'active') status = 'on_hold'
        }
        if (status !== item.status || item.app_id == null) {
          this.db.run('UPDATE library_items SET status = ?, app_id = ?, updated_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ?', [
            status, g.id, now, now, item.id
          ])
          changed++
        }
      }
    })
    if (changed) this.notify('library')
    return changed
  }

  /**
   * Albums (or artists, when the player reports no album) you listen to become
   * music items: played in the last two weeks → "listening", untouched for a
   * month → "on hold". Progress is the number of plays.
   */
  refreshMusicInLibrary(): number {
    const now = this.now()
    const recent = now - 14 * DAY
    const stale = now - 30 * DAY
    const ru = this.getSettings().language === 'ru'
    const sessions = this.db
      .all(`SELECT id, title, artist, album, start_ms, end_ms FROM media_sessions WHERE kind = 'music' AND artist <> '' ORDER BY start_ms`)
      .map((r) => ({
        id: r.id as T.ID,
        title: String(r.title),
        artist: String(r.artist),
        album: String(r.album),
        start: Number(r.start_ms),
        end: Number(r.end_ms)
      }))
    const starts = listenStarts(sessions)
    const groups = new Map<string, { artist: string; album: string; plays: number; ms: number; last: number }>()
    for (const s of sessions) {
      const key = `${s.artist.toLowerCase()}|${s.album.toLowerCase()}`
      const g = groups.get(key) ?? { artist: s.artist, album: s.album, plays: 0, ms: 0, last: 0 }
      g.ms += s.end - s.start
      g.last = Math.max(g.last, s.end)
      if (starts.has(s.id)) g.plays++
      groups.set(key, g)
    }
    let changed = 0
    transaction(this.db, () => {
      for (const r of groups.values()) {
        // Half a minute of an album is enough to put it on the shelf.
        if (r.ms < 30_000) continue
        const artist = String(r.artist)
        const album = String(r.album)
        const externalId = `music:${artist.toLowerCase()}|${album.toLowerCase()}`.slice(0, 500)
        const item = this.db.get(`SELECT * FROM library_items WHERE source = 'tracker' AND external_id = ?`, [externalId])
        if (!item) {
          this.db.run(
            `INSERT INTO library_items (kind, title, original_title, status, progress, format, source, external_id, status_auto,
               created_at, updated_at, started_at)
             VALUES ('music', ?, ?, ?, ?, ?, 'tracker', ?, 1, ?, ?, ?)`,
            [
              album || artist, album ? artist : '', r.last >= stale ? 'active' : 'on_hold', r.plays,
              album ? (ru ? 'Альбом' : 'Album') : ru ? 'Исполнитель' : 'Artist', externalId, now, now, now
            ]
          )
          changed++
          continue
        }
        let status: string = item.status
        if (bool(item.status_auto)) {
          if (r.last >= recent && ['planned', 'on_hold', 'dropped'].includes(status)) status = 'active'
          else if (r.last < stale && status === 'active') status = 'on_hold'
        }
        if (status !== item.status || Number(item.progress) !== r.plays) {
          this.db.run('UPDATE library_items SET status = ?, progress = ?, updated_at = ? WHERE id = ?', [status, r.plays, now, item.id])
          changed++
        }
      }
    })
    if (changed) this.notify('library')
    return changed
  }

  /** A track heard in timehub's own player (the renderer reports it when it ends or changes). */
  logPlayback(p: { title: string; artist: string; album: string; start: number; end: number }): void {
    if (!p.title || p.end - p.start < MIN_MEDIA_MS) return
    this.db.run('INSERT INTO media_sessions (source, title, artist, album, kind, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'timehub', p.title.slice(0, MAX_TITLE_LENGTH), p.artist.slice(0, MAX_TITLE_LENGTH), p.album.slice(0, MAX_TITLE_LENGTH), 'music',
      p.start, p.end
    ])
    this.refreshMusicInLibrary()
    this.notify('music')
  }

  // ------------------------------------------------------------------ social

  /** A call seen through Windows' microphone records; `end` grows while it lasts. */
  upsertCall(c: { exePath: string; app: string; start: number; end: number }): T.CallInfo {
    const existing = this.db.get('SELECT id, end_ms FROM calls WHERE exe_path = ? AND start_ms = ?', [c.exePath, c.start])
    if (existing) {
      if (c.end > Number(existing.end_ms)) {
        this.db.run('UPDATE calls SET end_ms = ? WHERE id = ?', [c.end, existing.id])
        this.notify('social')
      }
      return toCall(this.db.get(`${CALL_SELECT} WHERE c.id = ?`, [existing.id])!)
    }
    const app = this.db.get('SELECT id, exe_name FROM apps WHERE lower(exe_path) = lower(?)', [c.exePath])
    // Who it was with: the chat or channel open around the start of the call.
    let context = ''
    if (app) {
      const s = this.db.get(
        'SELECT title FROM activity_sessions WHERE app_id = ? AND end_ms >= ? AND start_ms <= ? ORDER BY end_ms DESC LIMIT 1',
        [app.id, c.start - 10 * MINUTE, c.end]
      )
      const chat = s ? parseChat(String(app.exe_name), String(s.title)) : null
      if (chat) context = chat.detail ? `${chat.name} · ${chat.detail}` : chat.name
    }
    const { lastId } = this.db.run('INSERT INTO calls (app_id, app_name, exe_path, context, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?)', [
      app?.id ?? null, c.app, c.exePath, context, c.start, c.end
    ])
    this.notify('social')
    return toCall(this.db.get(`${CALL_SELECT} WHERE c.id = ?`, [lastId])!)
  }

  listCalls(from: number, to: number): T.CallInfo[] {
    return this.db.all(`${CALL_SELECT} WHERE c.end_ms > ? AND c.start_ms < ? ORDER BY c.start_ms DESC`, [from, to]).map(toCall)
  }

  /** Messaging, conversations and calls — the Social tab. */
  getSocial(from: number, to: number): T.SocialSummary {
    const socialId = this.db.get(`SELECT id FROM categories WHERE key = 'social'`)?.id as T.ID | undefined
    const apps = new Map(this.listApps().map((a) => [a.id, a]))
    const isSocial = (app: T.AppInfo | undefined, categoryId: T.ID): boolean =>
      socialId != null && (categoryId === socialId || app?.categoryId === socialId)
    const byApp = new Map<T.ID, { ms: number; calls: number; callMs: number }>()
    const appEntry = (id: T.ID): { ms: number; calls: number; callMs: number } => {
      let e = byApp.get(id)
      if (!e) byApp.set(id, (e = { ms: 0, calls: 0, callMs: 0 }))
      return e
    }
    const days = new Map<string, { messagingMs: number; callMs: number }>()
    const dayEntry = (key: string): { messagingMs: number; callMs: number } => {
      let d = days.get(key)
      if (!d) days.set(key, (d = { messagingMs: 0, callMs: 0 }))
      return d
    }
    const chats = new Map<string, T.SocialChat>()
    let messagingMs = 0
    for (const s of this.listSessions(from, to)) {
      const app = apps.get(s.appId)
      if (!app || !isSocial(app, s.categoryId)) continue
      const ms = clipDuration(s.start, s.end, from, to)
      if (ms <= 0) continue
      messagingMs += ms
      appEntry(app.id).ms += ms
      dayEntry(dayKey(Math.max(s.start, from))).messagingMs += ms
      const chat = parseChat(app.exeName, s.title)
      if (!chat) continue
      const key = `${app.id}|${chat.kind}|${chat.name.toLowerCase()}`
      const c = chats.get(key) ?? {
        appId: app.id, app: app.displayName, icon: app.icon, kind: chat.kind, name: chat.name, detail: chat.detail ?? null, ms: 0, last: 0
      }
      c.ms += ms
      c.last = Math.max(c.last, s.end)
      chats.set(key, c)
    }
    const calls = this.listCalls(from, to)
    let callMs = 0
    let longest = 0
    for (const c of calls) {
      const ms = clipDuration(c.start, c.end, from, to)
      callMs += ms
      longest = Math.max(longest, c.end - c.start)
      if (c.appId != null) {
        const e = appEntry(c.appId)
        e.calls++
        e.callMs += ms
      }
      dayEntry(dayKey(Math.max(c.start, from))).callMs += ms
    }
    // Streak: days in a row with 5+ minutes of messaging or any call.
    const today = todayKey(this.now())
    const since = startOfDayMs(addDays(today, -120))
    const streakDays = new Map<string, number>()
    for (const s of this.listSessions(since, this.now())) {
      if (isSocial(apps.get(s.appId), s.categoryId)) bump(streakDays, dayKey(s.start), s.end - s.start)
    }
    for (const c of this.listCalls(since, this.now())) bump(streakDays, dayKey(c.start), Math.max(c.end - c.start, STREAK_MIN_MS))
    const daily: T.SocialSummary['daily'] = []
    for (let d = dayKey(from); d <= dayKey(to - 1); d = addDays(d, 1)) daily.push({ date: d, ...(days.get(d) ?? { messagingMs: 0, callMs: 0 }) })
    return {
      messagingMs,
      callMs,
      callCount: calls.length,
      longestCallMs: longest,
      streak: currentStreak(this.streakDays(streakDays), today),
      byApp: [...byApp]
        .map(([appId, v]) => ({ appId, name: apps.get(appId)?.displayName ?? '?', icon: apps.get(appId)?.icon ?? null, ...v }))
        .sort((a, b) => b.ms + b.callMs - (a.ms + a.callMs)),
      chats: [...chats.values()].sort((a, b) => b.ms - a.ms).slice(0, 20),
      calls: calls.slice(0, 50),
      daily
    }
  }

  /** All-time tracked time and last use per app (the Games tab). */
  appPlayTotals(): Map<T.ID, { ms: number; last: number }> {
    const out = new Map<T.ID, { ms: number; last: number }>()
    for (const r of this.db.all('SELECT app_id AS a, SUM(end_ms - start_ms) AS ms, MAX(end_ms) AS last FROM activity_sessions GROUP BY app_id')) {
      out.set(r.a as T.ID, { ms: Number(r.ms), last: Number(r.last) })
    }
    return out
  }

  /** Sets a cover found later (e.g. album art) without touching "recently updated". */
  setLibraryCover(id: T.ID, url: string): void {
    this.db.run('UPDATE library_items SET cover_url = ? WHERE id = ?', [url, id])
    this.notify('library')
  }

  /**
   * Runs once: past browser sessions whose tab title names a known site
   * (YouTube, Яндекс Музыка, GitHub…) move from the browser to that site.
   */
  splitBrowserSessionsBySite(): number {
    if (this.readSetting('_sitesSplit')) return 0
    let moved = 0
    transaction(this.db, () => {
      const browsers = (this.db.all('SELECT id, exe_name FROM apps') as { id: T.ID; exe_name: string }[]).filter((a) => isBrowserExe(a.exe_name))
      for (const b of browsers) {
        for (const s of this.db.all(`SELECT id, title FROM activity_sessions WHERE app_id = ? AND title <> ''`, [b.id])) {
          const site = detectSite(String(s.title))
          if (!site) continue
          const { app } = this.ensureApp(`site:${site.key}`, site.domain, site.name, site.category)
          this.db.run('UPDATE activity_sessions SET app_id = ?, title = ? WHERE id = ?', [app.id, site.pageTitle.slice(0, MAX_TITLE_LENGTH), s.id])
          moved++
        }
      }
      this.writeSetting('_sitesSplit', 1)
    })
    if (moved) {
      this.notify('meta')
      this.notify('activity')
    }
    return moved
  }

  /** Removes apps that must never be tracked (timehub itself) together with their history. */
  forgetApps(match: { paths?: string[]; names?: string[] }): number {
    const paths = new Set((match.paths ?? []).map((p) => p.toLowerCase()))
    const names = new Set((match.names ?? []).map((n) => n.toLowerCase()))
    const ids = (this.db.all('SELECT id, exe_path, exe_name FROM apps') as { id: T.ID; exe_path: string; exe_name: string }[])
      .filter((a) => paths.has(a.exe_path.toLowerCase()) || names.has(a.exe_name.toLowerCase()))
      .map((a) => a.id)
    if (!ids.length) return 0
    transaction(this.db, () => {
      for (const id of ids) {
        this.db.run('DELETE FROM activity_sessions WHERE app_id = ?', [id])
        this.db.run('DELETE FROM rules WHERE app_id = ?', [id])
        this.db.run('DELETE FROM app_links WHERE app_id = ?', [id])
        this.db.run('UPDATE library_items SET app_id = NULL WHERE app_id = ?', [id])
        this.db.run('DELETE FROM apps WHERE id = ?', [id])
      }
    })
    this.appCache.clear()
    this.notify('meta')
    this.notify('activity')
    return ids.length
  }

  // --------------------------------------------------- connections & external

  getIntegration(key: string): IntegrationRow {
    const row = this.db.get('SELECT * FROM integrations WHERE key = ?', [key])
    if (!row) return { enabled: false, config: {}, state: {}, updatedAt: 0 }
    return { enabled: bool(row.enabled), config: JSON.parse(row.config), state: JSON.parse(row.state), updatedAt: row.updated_at }
  }

  /** Shallow-merges config/state into the stored integration row. */
  saveIntegration(key: string, patch: { enabled?: boolean; config?: Record<string, unknown>; state?: Record<string, unknown> }): IntegrationRow {
    const current = this.getIntegration(key)
    const next = {
      enabled: patch.enabled ?? current.enabled,
      config: { ...current.config, ...patch.config },
      state: { ...current.state, ...patch.state },
      updatedAt: this.now()
    }
    this.db.run(
      `INSERT INTO integrations (key, enabled, config, state, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, config = excluded.config, state = excluded.state,
         updated_at = excluded.updated_at`,
      [key, next.enabled ? 1 : 0, JSON.stringify(next.config), JSON.stringify(next.state), next.updatedAt]
    )
    this.notify('connections')
    return next
  }

  /** Per-day numbers from a connected service (e.g. GitHub contributions). */
  setExternalDays(provider: string, days: T.DayValue[]): void {
    transaction(this.db, () => {
      for (const d of days) {
        this.db.run(
          'INSERT INTO external_days (provider, date, value) VALUES (?, ?, ?) ON CONFLICT(provider, date) DO UPDATE SET value = excluded.value',
          [provider, d.date, d.value]
        )
      }
    })
    this.notify('external')
  }

  getExternalDays(provider: string, fromKey: string, toKey: string): T.DayValue[] {
    const rows = this.db.all('SELECT date, value FROM external_days WHERE provider = ? AND date >= ? AND date <= ?', [provider, fromKey, toKey])
    const values = new Map(rows.map((r) => [r.date as string, r.value as number]))
    return eachDay(fromKey, toKey, (key) => values.get(key) ?? 0)
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
        const key = `${s.appId}\u0000${s.title}`
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
  getDailyActive(fromKey: string, toKey: string, appId?: T.ID): T.DayValue[] {
    const from = startOfDayMs(fromKey)
    const to = endOfDayMs(toKey)
    const params: SqlValue[] = [from, to]
    let onlyApp = ''
    if (appId != null) {
      onlyApp = ' AND s.app_id = ?'
      params.push(appId)
    }
    const rows = this.db.all(
      `SELECT s.start_ms AS s, s.end_ms AS e FROM activity_sessions s JOIN apps a ON a.id = s.app_id
       WHERE a.ignored = 0 AND s.end_ms > ? AND s.start_ms < ?${onlyApp}`,
      params
    ) as { s: number; e: number }[]
    const totals = spreadByDay(rows, from, to)
    return eachDay(fromKey, toKey, (key) => totals.get(key) ?? 0)
  }

  /** Active milliseconds per month in [fromKey, toKey]. */
  getMonthlyActive(fromKey: string, toKey: string, appId?: T.ID): T.MonthValue[] {
    const months = new Map<string, number>()
    for (const d of this.getDailyActive(fromKey, toKey, appId)) bump(months, d.date.slice(0, 7), d.value)
    return [...months].map(([month, value]) => ({ month, value }))
  }

  getHeatmap(metric: T.HeatmapMetric, fromKey: string, toKey: string): T.DayValue[] {
    if (metric === 'active') return this.getDailyActive(fromKey, toKey)
    if (metric === 'github') return this.getExternalDays('github', fromKey, toKey)
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
    const fromKey = addDays(todayKey(now), -(days - 1))
    const from = startOfDayMs(fromKey)
    const events: T.FeedEvent[] = []

    for (const r of this.db.all('SELECT id, number, title, created_at FROM tasks WHERE created_at >= ?', [from])) {
      events.push({ kind: 'task_created', at: r.created_at, taskId: r.id, number: r.number, title: r.title })
    }
    for (const r of this.db.all(`SELECT id, number, title, closed_at FROM tasks WHERE status = 'closed' AND closed_at >= ?`, [from])) {
      events.push({ kind: 'task_closed', at: r.closed_at, taskId: r.id, number: r.number, title: r.title })
    }
    for (const r of this.db.all('SELECT n.goal_id, n.body, n.created_at, g.title FROM goal_notes n JOIN goals g ON g.id = n.goal_id WHERE n.created_at >= ?', [from])) {
      if (r.body) events.push({ kind: 'goal_note', at: r.created_at, goalId: r.goal_id, title: r.title, body: r.body })
    }
    for (const r of this.db.all(`SELECT id, title, achieved_at FROM goals WHERE status = 'achieved' AND achieved_at >= ?`, [from])) {
      events.push({ kind: 'goal_achieved', at: r.achieved_at, goalId: r.id, title: r.title })
    }

    const logged = new Map<string, Extract<T.FeedEvent, { kind: 'time_logged' }>>()
    for (const e of this.listTimeEntries({ from })) {
      if (e.end == null) continue
      const key = `${e.taskId ?? `g${e.goalId}`}|${dayKey(e.end)}`
      const item = logged.get(key) ?? {
        kind: 'time_logged', at: e.end, taskId: e.taskId, goalId: e.goalId, number: e.taskNumber, title: e.title, ms: 0
      }
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
    for (const d of this.getExternalDays('github', fromKey, todayKey(now))) {
      if (d.value > 0) events.push({ kind: 'external', at: Math.min(now, endOfDayMs(d.date) - 1), date: d.date, provider: 'github', value: d.value })
    }
    return events.sort((a, b) => b.at - a.at)
  }

  // -------------------------------------------------------------------- export

  exportJson(): string {
    const tables: Record<string, Row[]> = {}
    const names = [
      'settings', 'projects', 'labels', 'tasks', 'task_labels', 'time_entries', 'recurrences', 'categories', 'rules',
      'activity_sessions', 'goals', 'goal_notes', 'media_sessions', 'calendar_events', 'app_links', 'external_days'
    ]
    for (const name of names) tables[name] = this.db.all(`SELECT * FROM ${name}`)
    tables.apps = this.db.all('SELECT id, exe_path, exe_name, display_name, category_id, record_titles, ignored, is_game, first_seen FROM apps')
    return JSON.stringify({ app: 'timehub', format: 2, exportedAt: new Date(this.now()).toISOString(), tables }, null, 2)
  }

  /** One timeline CSV with task/goal time, app activity and music (UTF-8 with BOM for Excel). */
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
      const what = e.taskNumber != null ? `#${e.taskNumber} ${e.title}` : `🎯 ${e.title}`
      rows.push({ start: e.start, cells: [e.taskId != null ? 'task' : 'goal', iso(e.start), iso(end), minutes(end - e.start), what, e.note || e.source, ''] })
    }
    for (const s of this.listSessions(0, Number.MAX_SAFE_INTEGER)) {
      rows.push({ start: s.start, cells: ['activity', iso(s.start), iso(s.end), minutes(s.end - s.start), apps.get(s.appId), s.title, categories.get(s.categoryId)] })
    }
    for (const m of this.db.all('SELECT * FROM media_sessions').map(toMedia)) {
      rows.push({ start: m.start, cells: ['music', iso(m.start), iso(m.end), minutes(m.end - m.start), m.source, `${m.artist} — ${m.title}`, ''] })
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
