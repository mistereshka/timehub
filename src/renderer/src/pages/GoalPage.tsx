import { useState, type ReactNode } from 'react'
import { Button, Checkbox, IconButton, Label, Textarea, Timeline, useConfirm } from '@primer/react'
import { ArchiveIcon, BellIcon, GoalIcon, IssueReopenedIcon, NoteIcon, PencilIcon, SyncIcon, TrashIcon, TrophyIcon } from '@primer/octicons-react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Goal, GoalInput, GoalNote } from '@shared/types'
import { MINUTE, addDays, dayKey, daysBetween, formatHM, todayKey } from '@shared/time'
import { buildHeatmap } from '@shared/heatmap'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { dayLabel, ruleText } from '../utils'
import { Blankslate, ErrorFlash, Markdown, Progress, ProgressSlider, StreakBadge } from '../components/common'
import { GoalDialog } from '../components/GoalDialog'
import { Heatmap } from '../components/Heatmap'
import { SubtaskList } from '../components/SubtaskList'
import { GoalTimerButton } from '../components/TimerButton'

export function GoalPage(): ReactNode {
  const { id } = useParams()
  const goalId = Number(id)
  const { t } = useI18n()
  const goal = useQuery(() => api.getGoal(goalId), [goalId], ['goals', 'time', 'tasks'])
  if (!goal.data) {
    if (goal.loading) return null
    return (
      <div className="container container-narrow">
        <Blankslate icon={<GoalIcon size={24} />} title={t('goals.notFound')}>
          <p>
            <Link to="/goals">{t('goals.back')}</Link>
          </p>
        </Blankslate>
      </div>
    )
  }
  return <GoalView key={goal.data.id} goal={goal.data} />
}

function GoalView({ goal }: { goal: Goal }): ReactNode {
  const { settings } = useApp()
  const i18n = useI18n()
  const { t, tn, ago, duration, date } = i18n
  const navigate = useNavigate()
  const confirm = useConfirm()
  const today = todayKey()
  const tasks = useQuery(() => api.listTasks({ goalId: goal.id }), [goal.id], ['tasks'])
  const notes = useQuery(() => api.listGoalNotes(goal.id), [goal.id], ['goals'])
  const entries = useQuery(() => api.listTimeEntries({ goalId: goal.id, withGoalTasks: true }), [goal.id], ['time'])
  const days = useQuery(() => api.getGoalDays(goal.id, addDays(today, -130), today), [goal.id, today], ['time'])
  const [editing, setEditing] = useState(false)
  const recurrences = useQuery(() => api.listRecurrences(), [], ['meta'])
  const practice = (recurrences.data ?? []).find((r) => r.goalId === goal.id && r.active)
  const update = useAction((patch: Partial<GoalInput>) => api.saveGoal({ id: goal.id, title: goal.title, ...patch }))

  const heat = days.data ? buildHeatmap(days.data, today, settings.weekStartsOn, 18) : null
  const weekMs = (days.data ?? []).slice(-7).reduce((s, d) => s + d.value, 0)
  const workedDays = (days.data ?? []).filter((d) => d.value > 0).length
  const left = goal.targetDate ? daysBetween(today, goal.targetDate) : null
  const autoFromTasks = goal.autoProgress && goal.taskCount > 0
  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: t('goals.deleteTitle'),
      content: t('goals.deleteConfirm'),
      confirmButtonType: 'danger',
      confirmButtonContent: t('common.delete')
    })
    if (!ok) return
    await api.deleteGoal(goal.id)
    navigate('/goals')
  }

  return (
    <div className="container">
      <div className="task-head">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <h1 className="task-title grow">
            <span className="goal-emoji lg" style={{ background: `color-mix(in srgb, ${goal.color} 22%, transparent)` }}>
              {goal.emoji}
            </span>{' '}
            {goal.title} <StreakBadge n={goal.streak} title={t('goals.streakTitle')} />
          </h1>
          <Button size="small" leadingVisual={PencilIcon} onClick={() => setEditing(true)}>
            {t('common.edit')}
          </Button>
        </div>
        <div className="row row-wrap mt-2">
          <Label variant={goal.status === 'active' ? 'success' : goal.status === 'achieved' ? 'done' : 'secondary'} size="large">
            {t(`goals.state.${goal.status}` as MessageKey)}
          </Label>
          <span className="muted">
            {t('goals.created', { ago: ago(goal.createdAt) })} · {t('task.trackedTotal', { time: duration(goal.trackedMs) })}
            {goal.targetDate ? ` · ${t('goals.until', { date: date(goal.targetDate, 'd MMM yyyy') })}` : ''}
          </span>
        </div>
      </div>

      <ErrorFlash error={update.error} />
      <div className="box box-body goal-progress-box mt-3">
        <div className="row">
          <span className="bold grow">{t('goals.progress')}</span>
          <span className="goal-percent">{goal.progress}%</span>
        </div>
        <Progress value={goal.progress / 100} color={goal.color} />
        {autoFromTasks ? (
          <div className="small muted">{t('goals.progressAuto', { done: goal.taskDone, total: goal.taskCount })}</div>
        ) : (
          goal.status === 'active' && <ProgressSlider value={goal.manualProgress} onCommit={(v) => void update.run({ manualProgress: v })} />
        )}
        <label className="check-field small">
          <Checkbox checked={goal.autoProgress} onChange={(e) => void update.run({ autoProgress: e.target.checked })} />
          <span>{t('goals.autoProgress')}</span>
        </label>
      </div>

      <div className="layout-sidebar mt-3">
        <div className="stack">
          <div className="comment-box">
            <div className="comment-box-header">
              <span className="grow">{t('task.body')}</span>
              <IconButton icon={PencilIcon} size="small" variant="invisible" aria-label={t('common.edit')} onClick={() => setEditing(true)} />
            </div>
            <div className="comment-box-body">
              {goal.body.trim() ? (
                <Markdown source={goal.body} />
              ) : (
                <p className="muted m-0">
                  <em>{t('task.noDescription')}</em>
                </p>
              )}
            </div>
          </div>
          <SubtaskList title={t('goals.tasksTitle')} tasks={tasks.data ?? []} onAdd={(title) => api.createTask({ title, goalId: goal.id })} />
          <Journal goal={goal} notes={notes.data ?? []} />
          <section>
            <h2 className="section-title">{t('task.timeLog')}</h2>
            {(entries.data ?? []).length === 0 ? (
              <div className="box box-body small muted">{t('goals.noTime')}</div>
            ) : (
              <div className="box">
                {(entries.data ?? []).slice(0, 15).map((e) => (
                  <div key={e.id} className="box-row small" style={{ alignItems: 'center' }}>
                    <span className="grow truncate">
                      {e.taskNumber != null ? (
                        <Link to={`/tasks/${e.taskNumber}`}>
                          #{e.taskNumber} {e.title}
                        </Link>
                      ) : (
                        <>🎯 {t('goals.onGoal')}</>
                      )}
                    </span>
                    <span className="muted nowrap">
                      {dayLabel(dayKey(e.start), i18n, 'd MMM')} {formatHM(e.start)}
                    </span>
                    <span className="bold nowrap">{duration((e.end ?? Date.now()) - e.start)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          {goal.status === 'active' && (
            <div className="sidebar-section">
              <GoalTimerButton goalId={goal.id} full />
            </div>
          )}
          <div className="sidebar-section stack stack-sm">
            <div className="sidebar-heading">{t('goals.stats')}</div>
            <div className="row small">
              <span className="grow muted">{t('goals.total')}</span>
              <span className="bold">{duration(goal.trackedMs)}</span>
            </div>
            <div className="row small">
              <span className="grow muted">{t('goals.thisWeek')}</span>
              <span className="bold">{duration(weekMs)}</span>
            </div>
            <div className="row small">
              <span className="grow muted">{t('goals.streak')}</span>
              <span className="bold">{tn('common.days', goal.streak)}</span>
            </div>
            <div className="row small">
              <span className="grow muted">{t('goals.daysWorked')}</span>
              <span className="bold">{workedDays}</span>
            </div>
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">
              {t('goals.plan')}
              <button type="button" className="link-button small" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>
            </div>
            {practice ? (
              <div className="stack stack-sm small">
                <Link to="/plan" className="row link-plain">
                  <SyncIcon size={12} />
                  {[ruleText(practice, i18n), practice.timeOfDay, practice.estimateMin ? duration(practice.estimateMin * MINUTE) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Link>
                {practice.timeOfDay && settings.reminders && (
                  <span className="row muted">
                    <BellIcon size={12} />
                    {settings.remindBeforeMin > 0 ? t('settings.remindMin', { n: settings.remindBeforeMin }) : t('settings.remindAtStart')}
                  </span>
                )}
              </div>
            ) : (
              <span className="small muted">{t('goals.noPlan')}</span>
            )}
          </div>
          {heat && (
            <div className="sidebar-section">
              <div className="sidebar-heading">{t('goals.activity')}</div>
              <Heatmap heatmap={heat} metric="active" weekStartsOn={settings.weekStartsOn} />
            </div>
          )}
          {goal.targetDate && (
            <div className="sidebar-section">
              <div className="sidebar-heading">{t('goals.target')}</div>
              <div>{date(goal.targetDate, 'd MMMM yyyy')}</div>
              {goal.status === 'active' && left != null && (
                <div className={`small ${left < 0 ? 'fg-danger' : 'muted'}`}>{left >= 0 ? tn('goals.daysLeft', left) : t('goals.overdue')}</div>
              )}
            </div>
          )}
          <div className="sidebar-section stack stack-sm">
            {goal.status === 'active' ? (
              <>
                <Button block leadingVisual={TrophyIcon} onClick={() => void update.run({ status: 'achieved' })}>
                  {t('goals.achieve')}
                </Button>
                <Button block leadingVisual={ArchiveIcon} onClick={() => void update.run({ status: 'archived' })}>
                  {t('goals.archive')}
                </Button>
              </>
            ) : (
              <Button block leadingVisual={IssueReopenedIcon} onClick={() => void update.run({ status: 'active' })}>
                {t('goals.reopen')}
              </Button>
            )}
            <Button block variant="invisible" leadingVisual={TrashIcon} onClick={() => void remove()}>
              <span className="fg-danger">{t('goals.delete')}</span>
            </Button>
          </div>
        </aside>
      </div>
      {editing && <GoalDialog goal={goal} onClose={() => setEditing(false)} />}
    </div>
  )
}

function Journal({ goal, notes }: { goal: Goal; notes: GoalNote[] }): ReactNode {
  const { t, ago } = useI18n()
  const [text, setText] = useState('')
  const [withProgress, setWithProgress] = useState(false)
  const [progress, setProgress] = useState(goal.progress)
  const add = useAction(async () => {
    await api.addGoalNote(goal.id, text, withProgress ? progress : null)
    setText('')
    setWithProgress(false)
  })
  return (
    <section>
      <h2 className="section-title">{t('goals.journal')}</h2>
      <div className="box box-body stack stack-sm">
        <ErrorFlash error={add.error} />
        <Textarea block rows={3} value={text} placeholder={t('goals.journalPlaceholder')} onChange={(e) => setText(e.target.value)} />
        <div className="row row-wrap">
          <label className="check-field small">
            <Checkbox checked={withProgress} onChange={(e) => setWithProgress(e.target.checked)} />
            <span>{t('goals.journalProgress', { n: progress })}</span>
          </label>
          {withProgress && (
            <input type="range" className="range grow" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
          )}
          <span className="grow" />
          <Button variant="primary" disabled={(!text.trim() && !withProgress) || add.busy} onClick={() => void add.run()}>
            {t('goals.journalSave')}
          </Button>
        </div>
      </div>
      {notes.length > 0 ? (
        <Timeline className="mt-2">
          {notes.map((n) => (
            <Timeline.Item key={n.id}>
              <Timeline.Badge>
                <NoteIcon />
              </Timeline.Badge>
              <Timeline.Body>
                <div className="row">
                  <span className="small muted grow">
                    {ago(n.createdAt)}
                    {n.progress != null ? ` · ${t('goals.noteProgress', { n: n.progress })}` : ''}
                  </span>
                  <IconButton icon={TrashIcon} size="small" variant="invisible" aria-label={t('common.delete')} onClick={() => void api.deleteGoalNote(n.id)} />
                </div>
                {n.body && <Markdown source={n.body} />}
              </Timeline.Body>
            </Timeline.Item>
          ))}
        </Timeline>
      ) : (
        <p className="small muted">{t('goals.journalEmpty')}</p>
      )}
    </section>
  )
}
