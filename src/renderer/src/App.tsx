import { useEffect, type ReactNode } from 'react'
import { BaseStyles } from '@primer/react'
import { ThemeProvider } from '@primer/react/next'
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router'
import { QuestionIcon } from '@primer/octicons-react'
import { api } from './api'
import { AppProvider, useApp } from './context'
import { useI18n } from './i18n'
import { AppHeader, MainNav } from './components/AppHeader'
import { TaskDialog } from './components/TaskDialog'
import { Blankslate } from './components/common'
import { OverviewPage } from './pages/OverviewPage'
import { TodayPage } from './pages/TodayPage'
import { PlanPage } from './pages/PlanPage'
import { TasksPage } from './pages/TasksPage'
import { TaskPage } from './pages/TaskPage'
import { LabelsPage } from './pages/LabelsPage'
import { SchedulePage } from './pages/SchedulePage'
import { ActivityPage } from './pages/ActivityPage'
import { SettingsPage } from './pages/SettingsPage'
import { GoalsPage } from './pages/GoalsPage'
import { GoalPage } from './pages/GoalPage'
import { LibraryPage } from './pages/LibraryPage'
import { AppReportPage } from './pages/AppReportPage'
import { ConnectionsPage } from './pages/ConnectionsPage'

export function App(): ReactNode {
  return (
    <AppProvider>
      <Themed>
        <HashRouter>
          <Shell />
        </HashRouter>
      </Themed>
    </AppProvider>
  )
}

/** Paints the native window buttons in the header color of the current theme. */
function syncTitleBar(): void {
  requestAnimationFrame(() => {
    const css = getComputedStyle(document.documentElement)
    const color = css.getPropertyValue('--bgColor-inset').trim()
    const symbolColor = css.getPropertyValue('--fgColor-default').trim()
    if (color && symbolColor) void api.setTitleBarTheme({ color, symbolColor })
  })
}

function Themed({ children }: { children: ReactNode }): ReactNode {
  const { theme, language } = useApp().settings
  const mode = theme === 'system' ? 'auto' : theme === 'light' ? 'light' : 'dark'
  const nightScheme = theme === 'dark_dimmed' ? 'dark_dimmed' : 'dark'

  useEffect(() => {
    const root = document.documentElement
    root.dataset.colorMode = mode
    root.dataset.lightTheme = 'light'
    root.dataset.darkTheme = nightScheme
    root.lang = language
    syncTitleBar()
    if (mode !== 'auto') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', syncTitleBar)
    return () => query.removeEventListener('change', syncTitleBar)
  }, [mode, nightScheme, language])

  return (
    <ThemeProvider colorMode={mode} dayScheme="light" nightScheme={nightScheme}>
      <BaseStyles>{children}</BaseStyles>
    </ThemeProvider>
  )
}

function Shell(): ReactNode {
  const { newTask, closeNewTask } = useApp()
  const { pathname } = useLocation()
  useEffect(() => {
    // Newer Chromium returns a Promise from scrollTo(); an effect must not return it.
    void document.getElementById('main')?.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="app">
      <div className="app-top">
        <AppHeader />
        <MainNav />
      </div>
      <main className="app-main" id="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:number" element={<TaskPage />} />
          <Route path="/labels" element={<LabelsPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/schedule/:date" element={<SchedulePage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/activity/apps/:id" element={<AppReportPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/goals/:id" element={<GoalPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {newTask && <TaskDialog defaults={newTask} onClose={closeNewTask} />}
    </div>
  )
}

function NotFound(): ReactNode {
  const { t } = useI18n()
  return (
    <div className="container container-narrow">
      <Blankslate icon={<QuestionIcon size={24} />} title={t('notFound.title')}>
        <p>
          <Link to="/">{t('notFound.back')}</Link>
        </p>
      </Blankslate>
    </div>
  )
}
