import { useState, type ReactNode } from 'react'
import { Button, CounterLabel, TextInput } from '@primer/react'
import { AlertIcon, CheckCircleIcon, PlusIcon, SunIcon } from '@primer/octicons-react'
import { Link } from 'react-router'
import type { Task } from '@shared/types'
import { MINUTE, endOfDayMs, startOfDayMs, todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useNow, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { AppIcon, AppUsageList, Blankslate, CategoryBar, ErrorFlash, Progress } from '../components/common'
import { TaskRow } from '../components/TaskRow'

const bySortOrder = (a: Task, b: Task): number => a.sortOrder - b.sortOrder || a.number - b.number

export function TodayPage(): ReactNode {
  const { t, date, duration } = useI18n()
  const today = todayKey()
  const tasks = useQuery(() => api.listTasks(), [], ['tasks'])
  const usage = useQuery(() => api.getUsage(startOfDayMs(today), endOfDayMs(today)), [today], ['activity', 'time', 'tasks'])
  const [title, setTitle] = useState('')
  const add = useAction(async () => {
    const value = title.trim()
    if (!value) return
    await api.createTask({ title: value, plannedDate: today })
    setTitle('')
  })
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  const all = tasks.data ?? []
  const isToday = (x: Task): boolean => x.plannedDate === today || (x.plannedDate == null && x.dueDate === today)
  const open = all.filter((x) => x.status === 'open')
  const planned = open.filter(isToday).sort(bySortOrder)
  const overdue = open
    .filter((x) => !isToday(x) && ((x.plannedDate != null && x.plannedDate < today) || (x.dueDate != null && x.dueDate < today)))
    .sort(bySortOrder)
  const dayStart = startOfDayMs(today)
  const done = all.filter((x) => x.status === 'closed' && (x.closedAt ?? 0) >= dayStart).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  const total = planned.length + done.length
  const estimate = planned.reduce((s, x) => s + (x.estimateMin ?? 0), 0)

  const drop = (targetId: number): void => {
    if (dragId == null || dragId === targetId) return
    const ids = planned.map((x) => x.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    void api.reorderTasks(ids)
  }
  const endDrag = (): void => {
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="container">
      <div className="layout-sidebar">
        <div className="stack">
          <div>
            <h1 className="page-title">
              {t('today.title')} <span className="muted">· {date(today, 'EEEE, d MMMM')}</span>
            </h1>
            {total > 0 && (
              <div className="row mt-2">
                <Progress value={done.length / total} />
                <span className="small muted nowrap">{t('today.progress', { done: done.length, total })}</span>
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void add.run()
            }}
          >
            <TextInput
              block
              size="large"
              leadingVisual={PlusIcon}
              placeholder={t('today.quickAdd')}
              aria-label={t('today.quickAdd')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </form>
          <ErrorFlash error={add.error} />

          {overdue.length > 0 && (
            <div className="box">
              <div className="box-header">
                <AlertIcon className="fg-attention" />
                <h2 className="box-title grow">
                  {t('today.overdue')} <CounterLabel>{overdue.length}</CounterLabel>
                </h2>
                <Button size="small" onClick={() => overdue.forEach((x) => void api.updateTask(x.id, { plannedDate: today }))}>
                  {t('today.moveAll')}
                </Button>
              </div>
              {overdue.map((x) => (
                <TaskRow key={x.id} task={x} checkbox />
              ))}
            </div>
          )}

          <div className="box">
            <div className="box-header">
              <SunIcon />
              <h2 className="box-title grow">
                {t('today.planned')} <CounterLabel>{planned.length}</CounterLabel>
              </h2>
              {estimate > 0 && <span className="small muted">{t('today.estimate', { time: duration(estimate * MINUTE) })}</span>}
            </div>
            {planned.length ? (
              planned.map((x) => (
                <TaskRow
                  key={x.id}
                  task={x}
                  checkbox
                  drag={{
                    dragging: dragId === x.id,
                    dropBefore: overId === x.id && dragId != null && dragId !== x.id,
                    onStart: () => setDragId(x.id),
                    onEnter: () => setOverId(x.id),
                    onDrop: () => drop(x.id),
                    onEnd: endDrag
                  }}
                />
              ))
            ) : (
              <Blankslate icon={<SunIcon size={24} />} title={t('today.emptyTitle')}>
                <p>{t('today.emptyText')}</p>
              </Blankslate>
            )}
          </div>

          {done.length > 0 && (
            <div className="box">
              <div className="box-header">
                <CheckCircleIcon className="fg-done" />
                <h2 className="box-title">
                  {t('today.done')} <CounterLabel>{done.length}</CounterLabel>
                </h2>
              </div>
              {done.map((x) => (
                <TaskRow key={x.id} task={x} checkbox />
              ))}
            </div>
          )}
        </div>

        <aside className="stack">
          <NowCard />
          <section className="box">
            <div className="box-header">
              <h2 className="box-title grow">{t('today.byApps')}</h2>
              <Link className="small" to="/schedule">
                {t('today.openSchedule')}
              </Link>
            </div>
            <div className="box-body stack stack-sm">
              <div className="row">
                <span className="grow muted small">{t('today.activeTime')}</span>
                <span className="bold">{duration(usage.data?.activeMs ?? 0)}</span>
              </div>
              <AppUsageList items={usage.data?.byApp ?? []} />
            </div>
          </section>
          <section className="box">
            <div className="box-header">
              <h2 className="box-title">{t('today.categories')}</h2>
            </div>
            <div className="box-body">
              <CategoryBar items={usage.data?.byCategory ?? []} />
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function NowCard(): ReactNode {
  const { tracker, timer, settings, categoryById, appById } = useApp()
  const { t, duration } = useI18n()
  const now = useNow(5000)
  const current = tracker.current
  const color = current ? categoryById.get(appById.get(current.appId)?.categoryId ?? -1)?.color : undefined

  let status: ReactNode
  if (!tracker.supported) status = <p className="muted small m-0">{t('today.trackerUnsupported')}</p>
  else if (settings.trackingPaused)
    status = (
      <div className="row">
        <span className="live-dot off" />
        <span className="muted">{t('tracker.paused')}</span>
      </div>
    )
  else if (current)
    status = (
      <div className="row">
        <AppIcon icon={current.icon} name={current.displayName} size={32} color={color} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="bold truncate">{current.displayName}</div>
          {current.title && (
            <div className="small muted truncate" title={current.title}>
              {current.title}
            </div>
          )}
        </div>
        <span className="small muted nowrap">{duration(now - current.since)}</span>
      </div>
    )
  else
    status = (
      <div className="row">
        <span className="live-dot idle" />
        <span className="muted">{t('tracker.idle')}</span>
      </div>
    )

  return (
    <section className="box">
      <div className="box-header">
        <h2 className="box-title">{t('today.now')}</h2>
      </div>
      <div className="box-body stack stack-sm">
        {status}
        {timer ? (
          <div className="row small">
            <span className="live-dot rec" />
            <Link to={`/tasks/${timer.taskNumber}`} className="truncate grow">
              #{timer.taskNumber} {timer.taskTitle}
            </Link>
            <span className="nowrap">{duration(now - timer.start)}</span>
          </div>
        ) : (
          <p className="small muted m-0">{t('today.noTimer')}</p>
        )}
      </div>
    </section>
  )
}
