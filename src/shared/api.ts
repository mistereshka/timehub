import type { Service } from './service'
import type {
  AppMeta, ChangeTopic, ConnectionKey, ConnectionPatch, ConnectionStatus, GameInfo, ID, LibraryKind, LibrarySearchResult,
  SpotifyOverview, TrackerStatus
} from './types'

export const IPC_INVOKE = 'timehub:invoke'
export const IPC_CHANGED = 'timehub:changed'

/** Service methods callable from the renderer. */
export const SERVICE_METHODS = [
  'getSettings', 'updateSettings',
  'listProjects', 'saveProject', 'deleteProject',
  'listLabels', 'saveLabel', 'deleteLabel',
  'listTasks', 'getTask', 'getTaskByNumber', 'createTask', 'updateTask', 'deleteTask', 'reorderTasks',
  'listTimeEntries', 'getRunningTimer', 'startTimer', 'startGoalTimer', 'stopTimer', 'addTimeEntry', 'updateTimeEntry',
  'deleteTimeEntry',
  'listRecurrences', 'saveRecurrence', 'deleteRecurrence',
  'listGoals', 'getGoal', 'saveGoal', 'deleteGoal', 'listGoalNotes', 'addGoalNote', 'deleteGoalNote', 'getGoalDays',
  'listCategories', 'saveCategory', 'deleteCategory',
  'listApps', 'updateApp', 'getAppLink', 'getAppReport', 'getAppStreaks',
  'listSessions', 'getUsage', 'getDailyActive', 'getMonthlyActive', 'getHeatmap', 'getFeed',
  'listRules', 'saveRule', 'deleteRule', 'reapplyRules',
  'getMusic', 'logPlayback', 'listCalendarEvents', 'getExternalDays',
  'listLibrary', 'getLibraryItem', 'saveLibraryItem', 'bumpLibraryProgress', 'deleteLibraryItem'
] as const satisfies readonly (keyof Service)[]
export type ServiceMethod = (typeof SERVICE_METHODS)[number]

/** Implemented by the host shell (Electron main process or the browser demo). */
export interface HostApi {
  getMeta(): AppMeta
  getTrackerStatus(): TrackerStatus
  /** Shows a save dialog; resolves to the written path, or null if cancelled. */
  exportData(format: 'json' | 'csv'): string | null
  openDataFolder(): void
  setTitleBarTheme(colors: { color: string; symbolColor: string }): void
  openExternal(url: string): void
  listConnections(): ConnectionStatus[]
  updateConnection(key: ConnectionKey, patch: ConnectionPatch): ConnectionStatus
  syncConnection(key: ConnectionKey): ConnectionStatus
  /** Runs the Spotify sign-in in the browser and waits for it to finish. */
  connectSpotify(): ConnectionStatus
  disconnectConnection(key: ConnectionKey): ConnectionStatus
  /** Store/platform data for a game (players online, cover…), if known. */
  getGameInfo(appId: ID): GameInfo | null
  getSpotifyOverview(): SpotifyOverview | null
  /** Finds titles to add to the library (AniLib, Open Library, Steam, TMDB…). */
  searchLibrary(kind: LibraryKind, query: string): LibrarySearchResult[]
  /** Shows a sample Windows notification; false when notifications aren't available. */
  testReminder(): boolean
  /** Dota 2 stats of a local Steam account (the one with most matches when null). */
  getDotaStats(accountId: string | null): import('./types').DotaStats | null
  /** Local music from the chosen folders (cached; `rescan` reads them again). */
  scanMusic(rescan: boolean): import('./types').MusicCollection
  /** Asks for folders to add to the music library; returns the folder list. */
  addMusicFolder(): string[]
  /** Play/pause, next or previous for whatever plays in Windows (Yandex Music in a browser, Spotify…). */
  mediaControl(action: import('./types').MediaAction): void
  /** Installed games from Steam, Epic, Battle.net and the tracker. */
  listGames(): import('./types').InstalledGame[]
  launchGame(id: string): void
}
export const HOST_METHODS = [
  'getMeta', 'getTrackerStatus', 'exportData', 'openDataFolder', 'setTitleBarTheme', 'openExternal',
  'listConnections', 'updateConnection', 'syncConnection', 'connectSpotify', 'disconnectConnection', 'getGameInfo',
  'getSpotifyOverview', 'searchLibrary', 'testReminder', 'getDotaStats', 'scanMusic', 'addMusicFolder', 'mediaControl', 'listGames',
  'launchGame'
] as const satisfies readonly (keyof HostApi)[]
export type HostMethod = (typeof HOST_METHODS)[number]

export type HostHandlers = {
  [K in HostMethod]: (...args: Parameters<HostApi[K]>) => ReturnType<HostApi[K]> | Promise<ReturnType<HostApi[K]>>
}

type Async<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never

export type TimehubApi = { [K in ServiceMethod]: Async<Service[K]> } & { [K in HostMethod]: Async<HostApi[K]> } & {
  onChange(listener: (topic: ChangeTopic) => void): () => void
}
