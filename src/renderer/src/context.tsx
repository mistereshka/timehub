import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AppInfo, AppMeta, Category, Label, Project, RunningTimer, Settings, TaskInput, TrackerStatus } from '@shared/types'
import { api } from './api'
import { useQuery } from './hooks'
import { I18nProvider } from './i18n'

export interface AppData {
  settings: Settings
  meta: AppMeta
  labels: Label[]
  projects: Project[]
  categories: Category[]
  apps: AppInfo[]
  labelById: Map<number, Label>
  projectById: Map<number, Project>
  categoryById: Map<number, Category>
  appById: Map<number, AppInfo>
  timer: RunningTimer | null
  tracker: TrackerStatus
  openCount: number
  updateSettings(patch: Partial<Settings>): Promise<void>
  /** Defaults of the "New task" dialog while it is open */
  newTask: Partial<TaskInput> | null
  openNewTask(defaults?: Partial<TaskInput>): void
  closeNewTask(): void
}

const AppContext = createContext<AppData | null>(null)
const byId = <T extends { id: number }>(list: T[]): Map<number, T> => new Map(list.map((x) => [x.id, x]))
const TRACKER_OFF: TrackerStatus = { supported: false, state: 'off', current: null, games: [] }

/** App-wide data (settings, labels, projects, apps, timer, tracker) kept fresh via change events. */
export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const settings = useQuery(() => api.getSettings(), [], ['settings'])
  const meta = useQuery(() => api.getMeta(), [])
  const labels = useQuery(() => api.listLabels(), [], ['meta'])
  const projects = useQuery(() => api.listProjects(), [], ['meta'])
  const categories = useQuery(() => api.listCategories(), [], ['meta'])
  const apps = useQuery(() => api.listApps(), [], ['meta'])
  const timer = useQuery(() => api.getRunningTimer(), [], ['time', 'tasks'])
  const tracker = useQuery(() => api.getTrackerStatus(), [], ['tracker'])
  const openCount = useQuery(async () => (await api.listTasks({ status: 'open' })).length, [], ['tasks'])

  const [newTask, setNewTask] = useState<Partial<TaskInput> | null>(null)
  const openNewTask = useCallback((defaults: Partial<TaskInput> = {}) => setNewTask(defaults), [])
  const closeNewTask = useCallback(() => setNewTask(null), [])
  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    await api.updateSettings(patch)
  }, [])

  const value = useMemo<AppData | null>(() => {
    if (!settings.data || !meta.data || !labels.data || !projects.data || !categories.data || !apps.data) return null
    return {
      settings: settings.data,
      meta: meta.data,
      labels: labels.data,
      projects: projects.data,
      categories: categories.data,
      apps: apps.data,
      labelById: byId(labels.data),
      projectById: byId(projects.data),
      categoryById: byId(categories.data),
      appById: byId(apps.data),
      timer: timer.data ?? null,
      tracker: tracker.data ?? TRACKER_OFF,
      openCount: openCount.data ?? 0,
      updateSettings,
      newTask,
      openNewTask,
      closeNewTask
    }
  }, [
    settings.data, meta.data, labels.data, projects.data, categories.data, apps.data, timer.data, tracker.data,
    openCount.data, newTask, updateSettings, openNewTask, closeNewTask
  ])

  if (!value) return settings.error ? <pre className="boot-error">{settings.error}</pre> : null
  return (
    <AppContext.Provider value={value}>
      <I18nProvider lang={value.settings.language}>{children}</I18nProvider>
    </AppContext.Provider>
  )
}

export function useApp(): AppData {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp() used outside <AppProvider>')
  return value
}
