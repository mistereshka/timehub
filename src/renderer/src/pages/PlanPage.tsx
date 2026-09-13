import { useState, type ReactNode } from 'react'
import { Button, Checkbox, IconButton, TextInput } from '@primer/react'
import { ChevronLeftIcon, ChevronRightIcon, FlameIcon, PencilIcon, PlusIcon, SyncIcon } from '@primer/octicons-react'
import { Link } from 'react-router'
import type { Recurrence, Task } from '@shared/types'
import { MINUTE, addDays, startOfWeek, todayKey } from '@shared/time'
import { occursOn } from '@shared/recurrence'
import { api } from '../api'
import { useApp } from '../context'
import { useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { ruleText } from '../utils'
import { Blankslate, StateIcon, TaskLabels } from '../components/common'
import { RecurrenceDialog } from '../components/RecurrenceDialog'

const BACKLOG = 'backlog'

export function PlanPage(): ReactNode {
  const { settings } = useApp()
  const i18n = useI18n()
  const { t, tn, date, duration } = i18n
  const today = todayKey()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today, settings.weekStartsOn))
  const tasks = useQuery(() => api.listTasks(), [], ['tasks'])
  const recurrences = useQuery(() => api.listRecurrences(), [], ['meta', 'tasks'])
  const [editing, setEditing] = useState<Recurrence | 'new' | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const all = tasks.data ?? []
  const recs = recurrences.data ?? []
  const columnTasks = (col: string): Task[] =>
    (col === BACKLOG ? all.filter((x) => x.status === 'open' && x.plannedDate == null) : all.filter((x) => x.plannedDate === col)).sort(
      (a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.sortOrder - b.sortOrder
    )
  // Future occurrences of recurring tasks are shown as dashed placeholders.
  const ghosts = (day: string): Recurrence[] => (day <= today ? [] : recs.filter((r) => r.active && occursOn(r, day)))
  const moveTo = (col: string, taskId: number): void => void api.updateTask(taskId, { plannedDate: col === BACKLOG ? null : col })

  return (
    <div className="container container-wide">
      <div className="page-head">
        <h1 className="page-title grow">{t('plan.title')}</h1>
        <IconButton icon={ChevronLeftIcon} aria-label={t('plan.prevWeek')} onClick={() => setWeekStart(addDays(weekStart, -7))} />
        <span className="bold nowrap">
          {date(weekStart, 'd MMM')} – {date(days[6], 'd MMM yyyy')}
        </span>
        <IconButton icon={ChevronRightIcon} aria-label={t('plan.nextWeek')} onClick={() => setWeekStart(addDays(weekStart, 7))} />
        <Button onClick={() => setWeekStart(startOfWeek(today, settings.weekStartsOn))}>{t('common.today')}</Button>
      </div>

      <div className="board">
        {[BACKLOG, ...days].map((col) => {
          const list = columnTasks(col)
          const openList = list.filter((x) => x.status === 'open')
          const est = openList.reduce((s, x) => s + (x.estimateMin ?? 0), 0)
          return (
            <div
              key={col}
              className={`board-col${col === today ? ' today' : ''}${dropTarget === col ? ' drop-target' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDropTarget(col)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget((d) => (d === col ? null : d))
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDropTarget(null)
                const id = Number(e.dataTransfer.getData('text/plain'))
                if (id) moveTo(col, id)
              }}
            >
              <div className="board-col-header">
                <span className="day">{col === BACKLOG ? t('plan.backlog') : date(col, 'EEEEEE, d')}</span>
                <span className="small muted nowrap">
                  {tn('plan.count', openList.length)}
                  {est > 0 ? ` · ${duration(est * MINUTE)}` : ''}
                </span>
              </div>
              <div className="board-col-body">
                {list.map((x) => (
                  <BoardCard key={x.id} task={x} />
                ))}
                {col !== BACKLOG &&
                  ghosts(col).map((r) => (
                    <div key={`r${r.id}`} className="board-card ghost" title={ruleText(r, i18n)}>
                      <div className="row small">
                        <SyncIcon size={12} />
                        <span className="truncate">{r.title}</span>
                      </div>
                    </div>
                  ))}
                <AddCard day={col === BACKLOG ? null : col} />
              </div>
            </div>
          )
        })}
      </div>

      <section className="mt-4">
        <div className="box">
          <div className="box-header">
            <SyncIcon />
            <h2 className="box-title grow">{t('plan.recurringTitle')}</h2>
            <Button size="small" leadingVisual={PlusIcon} onClick={() => setEditing('new')}>
              {t('plan.newRecurring')}
            </Button>
          </div>
          {recs.length === 0 ? (
            <Blankslate icon={<SyncIcon size={24} />} title={t('plan.noRecurring')}>
              <p>{t('plan.noRecurringText')}</p>
            </Blankslate>
          ) : (
            recs.map((r) => (
              <div key={r.id} className="box-row hoverable" style={{ alignItems: 'center' }}>
                <SyncIcon className={r.active ? 'fg-success' : 'muted'} />
                <div className="grow">
                  <div className="row row-wrap">
                    <span className={`bold${r.active ? '' : ' muted'}`}>{r.title}</span>
                    <TaskLabels ids={r.labelIds} />
                  </div>
                  <div className="small muted">
                    {ruleText(r, i18n)}
                    {r.estimateMin ? ` · ${duration(r.estimateMin * MINUTE)}` : ''} · {tn('plan.doneTimes', r.doneTotal)}
                  </div>
                </div>
                {r.streak > 0 && (
                  <span className="streak" title={t('plan.streakTitle')}>
                    <FlameIcon size={14} />
                    {r.streak}
                  </span>
                )}
                <label className="row small nowrap">
                  <Checkbox checked={r.active} onChange={(e) => void api.saveRecurrence({ ...r, active: e.target.checked })} />
                  {t('plan.active')}
                </label>
                <IconButton icon={PencilIcon} size="small" variant="invisible" aria-label={t('common.edit')} onClick={() => setEditing(r)} />
              </div>
            ))
          )}
        </div>
      </section>
      {editing && <RecurrenceDialog recurrence={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function BoardCard({ task }: { task: Task }): ReactNode {
  const { projectById } = useApp()
  const { duration } = useI18n()
  const project = task.projectId != null ? projectById.get(task.projectId) : undefined
  return (
    <div
      className={`board-card${task.status === 'closed' ? ' closed' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(task.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
        <span style={{ marginTop: 2 }}>
          <StateIcon task={task} size={14} />
        </span>
        <Link to={`/tasks/${task.number}`} className="board-card-title grow">
          {task.title}
        </Link>
      </div>
      <div className="board-card-meta">
        <span>#{task.number}</span>
        {task.recurrenceId != null && <SyncIcon size={12} />}
        {project && (
          <span className="row" style={{ gap: 4 }}>
            <span className="project-dot" style={{ background: project.color }} />
            {project.name}
          </span>
        )}
        {task.estimateMin ? <span>{duration(task.estimateMin * MINUTE)}</span> : null}
      </div>
      {task.labelIds.length > 0 && (
        <div className="board-card-labels">
          <TaskLabels ids={task.labelIds} />
        </div>
      )}
    </div>
  )
}

function AddCard({ day }: { day: string | null }): ReactNode {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  if (!open) {
    return (
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setOpen(true)} className="board-add-btn">
        {t('plan.add')}
      </Button>
    )
  }
  return (
    <form
      className="board-add"
      onSubmit={(e) => {
        e.preventDefault()
        const value = title.trim()
        if (value) void api.createTask({ title: value, plannedDate: day })
        setTitle('')
      }}
    >
      <TextInput
        size="small"
        block
        autoFocus
        value={title}
        placeholder={t('plan.addPlaceholder')}
        aria-label={t('plan.addPlaceholder')}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (!title.trim()) setOpen(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
    </form>
  )
}
