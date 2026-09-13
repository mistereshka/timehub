import type { Service } from './service'
import type { AppMeta, ChangeTopic, TrackerStatus } from './types'

export const IPC_INVOKE = 'timehub:invoke'
export const IPC_CHANGED = 'timehub:changed'

/** Service methods callable from the renderer. */
export const SERVICE_METHODS = [
  'getSettings', 'updateSettings',
  'listProjects', 'saveProject', 'deleteProject',
  'listLabels', 'saveLabel', 'deleteLabel',
  'listTasks', 'getTask', 'getTaskByNumber', 'createTask', 'updateTask', 'deleteTask', 'reorderTasks',
  'listTimeEntries', 'getRunningTimer', 'startTimer', 'stopTimer', 'addTimeEntry', 'updateTimeEntry', 'deleteTimeEntry',
  'listRecurrences', 'saveRecurrence', 'deleteRecurrence',
  'listCategories', 'saveCategory', 'deleteCategory',
  'listApps', 'updateApp',
  'listSessions', 'getUsage', 'getDailyActive', 'getHeatmap', 'getFeed',
  'listRules', 'saveRule', 'deleteRule', 'reapplyRules'
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
}
export const HOST_METHODS = [
  'getMeta', 'getTrackerStatus', 'exportData', 'openDataFolder', 'setTitleBarTheme', 'openExternal'
] as const satisfies readonly (keyof HostApi)[]
export type HostMethod = (typeof HOST_METHODS)[number]

export type HostHandlers = {
  [K in HostMethod]: (...args: Parameters<HostApi[K]>) => ReturnType<HostApi[K]> | Promise<ReturnType<HostApi[K]>>
}

type Async<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never

export type TimehubApi = { [K in ServiceMethod]: Async<Service[K]> } & { [K in HostMethod]: Async<HostApi[K]> } & {
  onChange(listener: (topic: ChangeTopic) => void): () => void
}
