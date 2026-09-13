import type { ReactNode } from 'react'
import { Checkbox } from '@primer/react'
import { CalendarIcon, ClockIcon, GrabberIcon, MilestoneIcon, SyncIcon } from '@primer/octicons-react'
import { Link } from 'react-router'
import type { Task } from '@shared/types'
import { MINUTE, todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useI18n } from '../i18n'
import { dayLabel } from '../utils'
import { PriorityLabel, ProjectBadge, StateIcon, TaskLabels } from './common'
import { TimerButton } from './TimerButton'

export interface RowDrag {
  dragging: boolean
  dropBefore: boolean
  onStart(): void
  onEnter(): void
  onDrop(): void
  onEnd(): void
}

/** One row of a GitHub-style issue list. */
export function TaskRow({ task, checkbox, drag }: { task: Task; checkbox?: boolean; drag?: RowDrag }): ReactNode {
  const { projectById } = useApp()
  const i18n = useI18n()
  const { t, ago, duration } = i18n
  const today = todayKey()
  const project = task.projectId != null ? projectById.get(task.projectId) : undefined
  const overdue = task.status === 'open' && task.dueDate != null && task.dueDate < today
  const toggle = (): void => void api.updateTask(task.id, { status: task.status === 'open' ? 'closed' : 'open' })
  const className = ['box-row hoverable task-row', task.status, drag?.dragging && 'dragging', drag?.dropBefore && 'drop-before']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      draggable={!!drag}
      onDragStart={
        drag
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(task.id))
              drag.onStart()
            }
          : undefined
      }
      onDragEnter={drag?.onEnter}
      onDragOver={drag ? (e) => e.preventDefault() : undefined}
      onDrop={
        drag
          ? (e) => {
              e.preventDefault()
              drag.onDrop()
            }
          : undefined
      }
      onDragEnd={drag?.onEnd}
    >
      {drag && (
        <span className="drag-handle" aria-hidden>
          <GrabberIcon size={16} />
        </span>
      )}
      {checkbox ? (
        <Checkbox
          className="task-check"
          checked={task.status === 'closed'}
          onChange={toggle}
          aria-label={t(task.status === 'open' ? 'task.close' : 'task.reopen')}
        />
      ) : (
        <span className="task-row-icon">
          <StateIcon task={task} />
        </span>
      )}
      <div className="grow">
        <Link to={`/tasks/${task.number}`} className="task-row-title">
          {task.title}
        </Link>
        <TaskLabels ids={task.labelIds} />
        <div className="task-row-meta">
          <span>
            #{task.number} ·{' '}
            {task.status === 'closed' && task.closedAt
              ? t('task.closedAgo', { ago: ago(task.closedAt) })
              : t('task.openedAgo', { ago: ago(task.createdAt) })}
          </span>
          {project && <ProjectBadge project={project} />}
          {task.recurrenceId != null && (
            <span className="item">
              <SyncIcon size={12} />
              {t('task.recurring')}
            </span>
          )}
          {task.plannedDate && (
            <span className="item">
              <CalendarIcon size={12} />
              {dayLabel(task.plannedDate, i18n)}
            </span>
          )}
          {task.dueDate && (
            <span className={`item${overdue ? ' fg-danger' : ''}`}>
              <MilestoneIcon size={12} />
              {t('task.due', { date: dayLabel(task.dueDate, i18n, 'd MMM') })}
            </span>
          )}
          <PriorityLabel priority={task.priority} />
        </div>
      </div>
      <div className="task-row-side">
        {(task.trackedMs > 0 || task.estimateMin) && (
          <span className="row nowrap" style={{ gap: 4 }}>
            <ClockIcon size={14} />
            {duration(task.trackedMs)}
            {task.estimateMin ? ` / ${duration(task.estimateMin * MINUTE)}` : ''}
          </span>
        )}
        {task.status === 'open' && <TimerButton task={task} />}
      </div>
    </div>
  )
}
