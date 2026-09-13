import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, TextInput, UnderlineNav } from '@primer/react'
import {
  CalendarIcon, ClockIcon, GearIcon, GraphIcon, HomeIcon, IssueOpenedIcon, PlusIcon, SearchIcon, SquareFillIcon, SunIcon
} from '@primer/octicons-react'
import { Link, useLocation, useNavigate } from 'react-router'
import type { RunningTimer } from '@shared/types'
import { formatClock } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useNow } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { isTypingTarget } from '../utils'
import { AppIcon } from './common'

export function AppHeader(): ReactNode {
  const { t } = useI18n()
  const { timer, openNewTask } = useApp()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // GitHub shortcuts: "/" focuses search, "c" creates a task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'c') {
        e.preventDefault()
        openNewTask()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openNewTask])

  return (
    <header className="app-header">
      <Link to="/" className="app-logo">
        <span className="app-logo-mark">
          <ClockIcon size={18} />
        </span>
        timehub
      </Link>
      <form
        className="app-search no-drag"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`/tasks?q=${encodeURIComponent(`is:open ${query.trim()} `)}`)
          setQuery('')
          searchRef.current?.blur()
        }}
      >
        <TextInput
          ref={searchRef}
          size="small"
          block
          leadingVisual={SearchIcon}
          trailingVisual={<kbd>/</kbd>}
          placeholder={t('header.search')}
          aria-label={t('header.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <div className="app-spacer" />
      <TrackerPills />
      {timer && <TimerPill timer={timer} />}
      <Button size="small" leadingVisual={PlusIcon} onClick={() => openNewTask()}>
        {t('header.newTask')}
      </Button>
    </header>
  )
}

function TrackerPills(): ReactNode {
  const { t, duration } = useI18n()
  const { tracker, settings } = useApp()
  const now = useNow(15_000)
  const navigate = useNavigate()
  if (!tracker.supported) return null

  let content: ReactNode
  if (settings.trackingPaused) {
    content = (
      <>
        <span className="live-dot off" />
        {t('tracker.paused')}
      </>
    )
  } else if (tracker.current) {
    content = (
      <>
        <span className="live-dot" />
        <AppIcon icon={tracker.current.icon} name={tracker.current.displayName} size={16} />
        <span className="truncate">{tracker.current.displayName}</span>
        <span className="muted">{duration(now - tracker.current.since)}</span>
      </>
    )
  } else if (tracker.state === 'idle' || tracker.state === 'locked') {
    content = (
      <>
        <span className="live-dot idle" />
        {t('tracker.idle')}
      </>
    )
  } else {
    content = (
      <>
        <span className="live-dot off" />
        {t('tracker.waiting')}
      </>
    )
  }

  const game = tracker.games[0]
  return (
    <>
      {game && !settings.trackingPaused && (
        <button type="button" className="pill" onClick={() => navigate('/activity')} title={t('tracker.gameRunning')}>
          <AppIcon icon={game.icon} name={game.displayName} size={16} />
          <span className="truncate">{t('tracker.playing', { name: game.displayName })}</span>
        </button>
      )}
      <button type="button" className="pill" onClick={() => navigate('/schedule')} title={tracker.current?.title || t('tracker.openSchedule')}>
        {content}
      </button>
    </>
  )
}

function TimerPill({ timer }: { timer: RunningTimer }): ReactNode {
  const now = useNow(1000)
  const { t } = useI18n()
  return (
    <span className="pill pill-timer">
      <span className="live-dot rec" />
      <Link to={`/tasks/${timer.taskNumber}`} className="link-plain truncate" title={timer.taskTitle}>
        #{timer.taskNumber} {timer.taskTitle}
      </Link>
      <span className="mono">{formatClock(now - timer.start)}</span>
      <button type="button" className="pill-btn" onClick={() => void api.stopTimer()} aria-label={t('timer.stop')} title={t('timer.stop')}>
        <SquareFillIcon size={12} />
      </button>
    </span>
  )
}

const NAV: { to: string; label: MessageKey; icon: typeof HomeIcon; exact?: boolean; counter?: boolean; also?: string[] }[] = [
  { to: '/', label: 'nav.overview', icon: HomeIcon, exact: true },
  { to: '/today', label: 'nav.today', icon: SunIcon },
  { to: '/plan', label: 'nav.plan', icon: CalendarIcon },
  { to: '/tasks', label: 'nav.tasks', icon: IssueOpenedIcon, counter: true, also: ['/labels'] },
  { to: '/schedule', label: 'nav.schedule', icon: ClockIcon },
  { to: '/activity', label: 'nav.activity', icon: GraphIcon },
  { to: '/settings', label: 'nav.settings', icon: GearIcon }
]

/** Repository-style tabs under the header. */
export function MainNav(): ReactNode {
  const { pathname } = useLocation()
  const { openCount } = useApp()
  const { t } = useI18n()
  const navigate = useNavigate()
  const matches = (to: string, exact?: boolean): boolean => (exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`))
  return (
    <nav className="app-nav">
      <UnderlineNav aria-label={t('nav.label')}>
        {NAV.map((item) => {
          const active = matches(item.to, item.exact) || (item.also ?? []).some((p) => matches(p))
          return (
            <UnderlineNav.Item
              key={item.to}
              href={`#${item.to}`}
              leadingVisual={<item.icon />}
              counter={item.counter ? openCount : undefined}
              aria-current={active ? 'page' : undefined}
              onSelect={(e) => {
                e.preventDefault()
                navigate(item.to)
              }}
            >
              {t(item.label)}
            </UnderlineNav.Item>
          )
        })}
      </UnderlineNav>
    </nav>
  )
}
