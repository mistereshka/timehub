export type ID = number
export type Lang = 'ru' | 'en'
export type ThemeSetting = 'system' | 'light' | 'dark' | 'dark_dimmed'
export type HeatmapMetric = 'active' | 'tasks'
export type TaskStatus = 'open' | 'closed'
/** 0 = none, 1 = low, 2 = medium, 3 = high */
export type Priority = 0 | 1 | 2 | 3

export interface Settings {
  language: Lang
  theme: ThemeSetting
  pollIntervalSec: number
  idleThresholdMin: number
  autostart: boolean
  closeToTray: boolean
  trackingPaused: boolean
  heatmapMetric: HeatmapMetric
  /** 0 = Sunday (GitHub style), 1 = Monday */
  weekStartsOn: 0 | 1
}

export interface Project {
  id: ID
  name: string
  color: string
  description: string
  archived: boolean
  createdAt: number
}
export interface ProjectInput {
  id?: ID
  name: string
  color: string
  description?: string
  archived?: boolean
}

export interface Label {
  id: ID
  name: string
  color: string
  description: string
}
export interface LabelInput {
  id?: ID
  name: string
  color: string
  description?: string
}

export interface Task {
  id: ID
  number: number
  title: string
  body: string
  status: TaskStatus
  priority: Priority
  projectId: ID | null
  labelIds: ID[]
  /** yyyy-mm-dd */
  dueDate: string | null
  /** Day the task is planned for, yyyy-mm-dd */
  plannedDate: string | null
  estimateMin: number | null
  recurrenceId: ID | null
  sortOrder: number
  createdAt: number
  updatedAt: number
  closedAt: number | null
  /** Sum of all time entries, including a running timer */
  trackedMs: number
}
export interface TaskInput {
  title: string
  body?: string
  priority?: Priority
  projectId?: ID | null
  labelIds?: ID[]
  dueDate?: string | null
  plannedDate?: string | null
  estimateMin?: number | null
}
export interface TaskPatch extends Partial<TaskInput> {
  status?: TaskStatus
}

export type TimeSource = 'timer' | 'manual' | 'rule'
export interface TimeEntry {
  id: ID
  taskId: ID
  taskNumber: number
  taskTitle: string
  start: number
  /** null while the timer is running */
  end: number | null
  source: TimeSource
  note: string
}
export interface TimeEntryInput {
  taskId: ID
  start: number
  end: number
  note?: string
}
export interface TimeEntryPatch {
  start?: number
  end?: number
  note?: string
}
export interface RunningTimer {
  entryId: ID
  taskId: ID
  taskNumber: number
  taskTitle: string
  start: number
}

export type RecurrenceRule = 'daily' | 'weekdays' | 'weekly' | 'monthly'
export interface Recurrence {
  id: ID
  title: string
  body: string
  rule: RecurrenceRule
  /** weekly rule: bit 0 = Monday … bit 6 = Sunday */
  daysMask: number
  /** monthly rule: 1..31, clamped to the month's last day */
  dayOfMonth: number | null
  projectId: ID | null
  labelIds: ID[]
  estimateMin: number | null
  active: boolean
  startDate: string
  lastGenerated: string | null
  createdAt: number
  /** Consecutive completed occurrences up to today */
  streak: number
  doneTotal: number
}
export interface RecurrenceInput {
  id?: ID
  title: string
  body?: string
  rule: RecurrenceRule
  daysMask?: number
  dayOfMonth?: number | null
  projectId?: ID | null
  labelIds?: ID[]
  estimateMin?: number | null
  active?: boolean
  startDate?: string
}

export interface Category {
  id: ID
  /** Built-in categories have a key and a translated name */
  key: string | null
  name: string
  color: string
}
export interface CategoryInput {
  id?: ID
  name: string
  color: string
}

export interface AppInfo {
  id: ID
  exePath: string
  exeName: string
  displayName: string
  icon: string | null
  categoryId: ID | null
  recordTitles: boolean
  ignored: boolean
  isGame: boolean
  firstSeen: number
}
export interface AppPatch {
  displayName?: string
  categoryId?: ID | null
  recordTitles?: boolean
  ignored?: boolean
  isGame?: boolean
  /** Also erase window titles already recorded for this app */
  scrubTitles?: boolean
}

export interface ActivitySession {
  id: ID
  appId: ID
  title: string
  start: number
  end: number
  taskId: ID | null
  /** Effective category: rule override, else the app's category */
  categoryId: ID
}

export interface Rule {
  id: ID
  appId: ID | null
  /** Case-insensitive substring, or /regex/ */
  titlePattern: string
  taskId: ID | null
  categoryId: ID | null
  createdAt: number
}
export interface RuleInput {
  id?: ID
  appId: ID | null
  titlePattern: string
  taskId: ID | null
  categoryId: ID | null
}

export interface UsageItem {
  id: ID
  ms: number
}
export interface UsageSummary {
  from: number
  to: number
  activeMs: number
  firstActivity: number | null
  lastActivity: number | null
  byApp: UsageItem[]
  byCategory: UsageItem[]
  byTitle: { appId: ID; title: string; ms: number }[]
  taskMs: number
  tasksClosed: number
}

export interface DayValue {
  date: string
  value: number
}

export type FeedEvent =
  | { kind: 'task_created'; at: number; taskId: ID; number: number; title: string }
  | { kind: 'task_closed'; at: number; taskId: ID; number: number; title: string }
  | { kind: 'time_logged'; at: number; taskId: ID; number: number; title: string; ms: number }
  | { kind: 'day_summary'; at: number; date: string; activeMs: number; topAppId: ID | null; topAppMs: number }

export type TrackerState = 'active' | 'idle' | 'paused' | 'locked' | 'ignored' | 'off'
export interface TrackerStatus {
  /** false when the platform has no tracker (e.g. demo mode in a browser) */
  supported: boolean
  state: TrackerState
  current: { appId: ID; displayName: string; icon: string | null; title: string; since: number } | null
  games: { appId: ID; displayName: string; icon: string | null; since: number }[]
}

export interface AppMeta {
  version: string
  dataPath: string
  demo: boolean
  platform: string
  packaged: boolean
}

export type ChangeTopic = 'settings' | 'tasks' | 'time' | 'meta' | 'activity' | 'tracker'
