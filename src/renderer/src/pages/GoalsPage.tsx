import { useState, type ReactNode } from 'react'
import { Button, SegmentedControl } from '@primer/react'
import { ClockIcon, GoalIcon, IssueTracksIcon, PlusIcon } from '@primer/octicons-react'
import { Link, useNavigate } from 'react-router'
import type { Goal, GoalStatus } from '@shared/types'
import { daysBetween, todayKey } from '@shared/time'
import { useApp } from '../context'
import { useI18n, type MessageKey } from '../i18n'
import { Blankslate, Progress, StreakBadge } from '../components/common'
import { GoalDialog } from '../components/GoalDialog'
import { GoalTimerButton } from '../components/TimerButton'

const TABS: GoalStatus[] = ['active', 'achieved', 'archived']

/** The goals journal: long-term goals with progress, time and streaks. */
export function GoalsPage(): ReactNode {
  const { goals } = useApp()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [tab, setTab] = useState<GoalStatus>('active')
  const [creating, setCreating] = useState(false)
  const count = (s: GoalStatus): number => goals.filter((g) => g.status === s).length
  const list = goals.filter((g) => g.status === tab)

  return (
    <div className="container">
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">{t('goals.title')}</h1>
          <div className="muted">{t('goals.subtitle')}</div>
        </div>
        <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setCreating(true)}>
          {t('goals.new')}
        </Button>
      </div>
      <SegmentedControl aria-label={t('goals.title')} onChange={(i) => setTab(TABS[i])}>
        {TABS.map((s) => (
          <SegmentedControl.Button key={s} selected={tab === s}>
            {`${t(`goals.tab.${s}` as MessageKey)} · ${count(s)}`}
          </SegmentedControl.Button>
        ))}
      </SegmentedControl>
      {list.length ? (
        <div className="goal-grid mt-3">
          {list.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      ) : (
        <div className="box mt-3">
          <Blankslate icon={<GoalIcon size={24} />} title={t(tab === 'active' ? 'goals.emptyTitle' : 'goals.emptyOther')}>
            {tab === 'active' && (
              <>
                <p>{t('goals.emptyText')}</p>
                <Button variant="primary" onClick={() => setCreating(true)}>
                  {t('goals.new')}
                </Button>
              </>
            )}
          </Blankslate>
        </div>
      )}
      {creating && (
        <GoalDialog
          goal={null}
          onClose={(saved) => {
            setCreating(false)
            if (saved) navigate(`/goals/${saved.id}`)
          }}
        />
      )}
    </div>
  )
}

export function GoalCard({ goal }: { goal: Goal }): ReactNode {
  const { t, tn, duration, ago, date } = useI18n()
  const left = goal.targetDate ? daysBetween(todayKey(), goal.targetDate) : null
  return (
    <div className="goal-card box">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="goal-emoji" style={{ background: `color-mix(in srgb, ${goal.color} 22%, transparent)` }}>
          {goal.emoji}
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={`/goals/${goal.id}`} className="goal-title link-plain">
            {goal.title}
          </Link>
          {goal.targetDate && (
            <div className={`small ${left != null && left < 0 && goal.status === 'active' ? 'fg-danger' : 'muted'}`}>
              {t('goals.until', { date: date(goal.targetDate, 'd MMM yyyy') })}
              {goal.status === 'active' && left != null ? ` · ${left >= 0 ? tn('goals.daysLeft', left) : t('goals.overdue')}` : ''}
            </div>
          )}
        </div>
        <StreakBadge n={goal.streak} title={t('goals.streakTitle')} />
      </div>
      <div className="goal-progress">
        <Progress value={goal.progress / 100} color={goal.color} />
        <span className="bold nowrap">{goal.progress}%</span>
      </div>
      <div className="row row-wrap small muted">
        <span className="row" style={{ gap: 4 }}>
          <ClockIcon size={12} />
          {duration(goal.trackedMs)}
        </span>
        {goal.taskCount > 0 && (
          <span className="row" style={{ gap: 4 }}>
            <IssueTracksIcon size={12} />
            {t('goals.tasks', { done: goal.taskDone, total: goal.taskCount })}
          </span>
        )}
        {goal.lastWorkedAt && <span>{t('goals.lastWorked', { ago: ago(goal.lastWorkedAt) })}</span>}
        <span className="grow" />
        {goal.status === 'active' && <GoalTimerButton goalId={goal.id} />}
      </div>
    </div>
  )
}
