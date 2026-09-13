export type ID = number
export type Lang = 'ru' | 'en'
export type ThemeSetting = 'system' | 'light' | 'dark' | 'dark_dimmed'
export type HeatmapMetric = 'active' | 'tasks' | 'github'
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
  /** Windows notifications before timed tasks and calendar events */
  reminders: boolean
  /** Minutes before the start; 0 = at the start */
  remindBeforeMin: number
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
  /** Planned start time on that day, HH:MM */
  plannedTime: string | null
  estimateMin: number | null
  recurrenceId: ID | null
  /** Parent task (sub-issue) */
  parentId: ID | null
  goalId: ID | null
  /** Manually set completion percent; null = derived from subtasks */
  progress: number | null
  childCount: number
  childDone: number
  /** Streak of the recurrence this task is an instance of (0 if none) */
  streak: number
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
  plannedTime?: string | null
  estimateMin?: number | null
  parentId?: ID | null
  goalId?: ID | null
  progress?: number | null
}
export interface TaskPatch extends Partial<TaskInput> {
  status?: TaskStatus
}

export type TimeSource = 'timer' | 'manual' | 'rule'
export interface TimeEntry {
  id: ID
  /** Exactly one of taskId / goalId is set */
  taskId: ID | null
  goalId: ID | null
  taskNumber: number | null
  /** Task or goal title */
  title: string
  start: number
  /** null while the timer is running */
  end: number | null
  source: TimeSource
  note: string
}
export interface TimeEntryInput {
  taskId?: ID | null
  goalId?: ID | null
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
  taskId: ID | null
  goalId: ID | null
  taskNumber: number | null
  title: string
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
  /** Planned start time of each instance, HH:MM */
  timeOfDay: string | null
  /** Close the instance automatically once its estimate is tracked */
  completeOnTarget: boolean
  projectId: ID | null
  goalId: ID | null
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
  timeOfDay?: string | null
  completeOnTarget?: boolean
  projectId?: ID | null
  goalId?: ID | null
  labelIds?: ID[]
  estimateMin?: number | null
  active?: boolean
  startDate?: string
}

export type GoalStatus = 'active' | 'achieved' | 'archived'
export interface Goal {
  id: ID
  title: string
  body: string
  emoji: string
  color: string
  status: GoalStatus
  /** Effective progress 0–100: from tasks when autoProgress and there are tasks */
  progress: number
  manualProgress: number
  autoProgress: boolean
  targetDate: string | null
  createdAt: number
  updatedAt: number
  achievedAt: number | null
  /** Time on the goal itself plus its tasks */
  trackedMs: number
  taskCount: number
  taskDone: number
  /** Consecutive days with work or journal notes on the goal */
  streak: number
  lastWorkedAt: number | null
}
export interface GoalInput {
  id?: ID
  title: string
  body?: string
  emoji?: string
  color?: string
  status?: GoalStatus
  manualProgress?: number
  autoProgress?: boolean
  targetDate?: string | null
}
export interface GoalNote {
  id: ID
  goalId: ID
  body: string
  /** Progress set together with the note, if any */
  progress: number | null
  createdAt: number
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

export type GameProvider = 'steam' | 'roblox' | 'epic' | 'riot'
/** External identity of a tracked app, e.g. a Steam app id. */
export interface AppLink {
  appId: ID
  provider: GameProvider
  externalId: string
  name: string | null
  imageUrl: string | null
  storeUrl: string | null
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
  goalId: ID | null
  categoryId: ID | null
  createdAt: number
}
export interface RuleInput {
  id?: ID
  appId: ID | null
  titlePattern: string
  taskId: ID | null
  goalId?: ID | null
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
export interface MonthValue {
  /** yyyy-mm */
  month: string
  value: number
}

/** Everything timehub knows about one app, all time. */
export interface AppReport {
  app: AppInfo
  link: AppLink | null
  totalMs: number
  sessions: number
  activeDays: number
  firstSeen: number | null
  lastUsed: number | null
  /** Longest uninterrupted stretch in the app */
  longestRunMs: number
  avgPerActiveDayMs: number
  streak: number
  bestStreak: number
  /** Last 53 weeks, ms per day */
  daily: DayValue[]
  /** Last 12 months, ms per month */
  monthly: MonthValue[]
  /** ms per hour of day, 0–23 */
  byHour: number[]
  /** ms per weekday, Monday first */
  byWeekday: number[]
  topTitles: { title: string; ms: number }[]
  /** Code editors: time per project parsed from window titles */
  projects: { name: string; ms: number }[]
}
export interface AppStreak {
  appId: ID
  streak: number
}

export interface MediaSession {
  id: ID
  /** Player app id (e.g. Spotify.exe) */
  source: string
  title: string
  artist: string
  album: string
  start: number
  end: number
}
export interface MusicSummary {
  totalMs: number
  plays: number
  topArtists: { name: string; ms: number; plays: number }[]
  topTracks: { title: string; artist: string; ms: number; plays: number }[]
  bySource: { source: string; ms: number }[]
  recent: MediaSession[]
}

export interface CalendarEvent {
  id: ID
  /** Calendar source id */
  source: string
  uid: string
  title: string
  location: string
  start: number
  end: number
  allDay: boolean
  color: string
}

export type FeedEvent =
  | { kind: 'task_created'; at: number; taskId: ID; number: number; title: string }
  | { kind: 'task_closed'; at: number; taskId: ID; number: number; title: string }
  | { kind: 'time_logged'; at: number; taskId: ID | null; goalId: ID | null; number: number | null; title: string; ms: number }
  | { kind: 'day_summary'; at: number; date: string; activeMs: number; topAppId: ID | null; topAppMs: number }
  | { kind: 'goal_note'; at: number; goalId: ID; title: string; body: string }
  | { kind: 'goal_achieved'; at: number; goalId: ID; title: string }
  | { kind: 'external'; at: number; date: string; provider: string; value: number }

export type TrackerState = 'active' | 'idle' | 'paused' | 'locked' | 'ignored' | 'off'

/** A running game, enriched Discord-style with store data when available. */
export interface GamePresence {
  appId: ID
  displayName: string
  icon: string | null
  since: number
  provider: GameProvider | null
  /** e.g. the Roblox experience name */
  details: string | null
  imageUrl: string | null
  playersOnline: number | null
  storeUrl: string | null
  totalMs: number
  todayMs: number
  streak: number
  /** Playtime reported by the platform (Steam), minutes */
  platformPlaytimeMin: number | null
}

/** Browsers also report videos (YouTube, Shorts, Twitch) as media sessions. */
export type MediaKind = 'music' | 'video'

/** What's playing in Spotify, Yandex Music, a browser… (Windows media sessions). */
export interface MediaPresence {
  source: string
  sourceName: string
  title: string
  artist: string
  album: string
  playing: boolean
  kind: MediaKind
  positionMs: number | null
  durationMs: number | null
  updatedAt: number
  /** Cover art as data or https URL */
  thumbnail: string | null
}

export interface TrackerStatus {
  /** false when the platform has no tracker (e.g. demo mode in a browser) */
  supported: boolean
  state: TrackerState
  current: { appId: ID; displayName: string; icon: string | null; title: string; since: number } | null
  games: GamePresence[]
  media: MediaPresence | null
}

export interface GameInfo {
  link: AppLink | null
  details: string | null
  playersOnline: number | null
  platformPlaytimeMin: number | null
}

export type ConnectionKey =
  | 'steam'
  | 'roblox'
  | 'media'
  | 'spotify'
  | 'github'
  | 'calendar'
  | 'discord'
  | 'epic'
  | 'anilib'
  | 'shikimori'
  | 'tmdb'
export interface ConnectionStatus {
  key: ConnectionKey
  enabled: boolean
  connected: boolean
  account: string | null
  avatar: string | null
  /** Human-readable summary, e.g. "17 games in the library" */
  detail: string | null
  error: string | null
  lastSync: number | null
  /** Non-secret settings */
  settings: Record<string, string>
  /** Names of secrets that are stored (their values never reach the UI) */
  secretsSet: string[]
}
export interface ConnectionPatch {
  enabled?: boolean
  settings?: Record<string, string>
  /** null removes the secret */
  secrets?: Record<string, string | null>
}
export interface CalendarSourceConfig {
  id: string
  name: string
  url: string
  color: string
}

export interface SpotifyOverview {
  profile: { name: string; avatar: string | null; url: string | null }
  topArtists: { name: string; image: string | null; url: string | null }[]
  topTracks: { title: string; artist: string; image: string | null; url: string | null }[]
  recent: { title: string; artist: string; playedAt: number; image: string | null }[]
}

export type LibraryKind = 'anime' | 'manga' | 'book' | 'movie' | 'series' | 'game' | 'music'
/** active = watching / reading / playing, depending on the kind */
export type LibraryStatus = 'active' | 'planned' | 'completed' | 'dropped' | 'on_hold' | 'rewatching'
export type LibrarySource = 'manual' | 'anilib' | 'mangalib' | 'ranobelib' | 'shikimori' | 'steam' | 'tracker'

export interface LibraryItem {
  id: ID
  kind: LibraryKind
  title: string
  originalTitle: string
  coverUrl: string | null
  status: LibraryStatus
  favorite: boolean
  /** Episodes watched / chapters read / hours played… */
  progress: number
  total: number | null
  /** Latest released episode or chapter reported by the source */
  latest: number | null
  /** 1–10 */
  rating: number | null
  notes: string
  year: number | null
  /** e.g. "TV Сериал", "Фильм", "Манга" */
  format: string
  source: LibrarySource
  externalId: string | null
  url: string | null
  /** Tracked app (games) */
  appId: ID | null
  /** Status follows the source / tracker; cleared once you change it by hand */
  statusAuto: boolean
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
  /** Games: time tracked by timehub */
  trackedMs: number
  lastActivityAt: number | null
}
export interface LibraryInput {
  id?: ID
  kind: LibraryKind
  title: string
  originalTitle?: string
  coverUrl?: string | null
  status?: LibraryStatus
  favorite?: boolean
  progress?: number
  total?: number | null
  rating?: number | null
  notes?: string
  year?: number | null
  format?: string
  url?: string | null
  appId?: ID | null
  statusAuto?: boolean
}
/** An item coming from a connected service (AniLib, Steam…). */
export interface LibraryImport {
  kind: LibraryKind
  externalId: string
  title: string
  originalTitle?: string
  coverUrl?: string | null
  status: LibraryStatus
  favorite?: boolean
  progress?: number
  total?: number | null
  latest?: number | null
  rating?: number | null
  year?: number | null
  format?: string
  url?: string | null
  appId?: ID | null
}
export interface LibrarySearchResult {
  kind: LibraryKind
  title: string
  originalTitle: string
  coverUrl: string | null
  year: number | null
  total: number | null
  format: string
  url: string | null
  source: string
}

export interface AppMeta {
  version: string
  dataPath: string
  demo: boolean
  platform: string
  packaged: boolean
}

export type ChangeTopic =
  | 'settings'
  | 'tasks'
  | 'time'
  | 'meta'
  | 'activity'
  | 'tracker'
  | 'goals'
  | 'music'
  | 'connections'
  | 'calendar'
  | 'external'
  | 'library'
