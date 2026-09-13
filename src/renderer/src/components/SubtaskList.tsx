import { useState, type ReactNode } from 'react'
import { Checkbox, CounterLabel, TextInput } from '@primer/react'
import { ClockIcon, IssueTracksIcon, PlusIcon } from '@primer/octicons-react'
import { Link } from 'react-router'
import type { Task } from '@shared/types'
import { api } from '../api'
import { useAction } from '../hooks'
import { useI18n } from '../i18n'
import { ErrorFlash, MiniProgress } from './common'
import { TimerButton } from './TimerButton'

/** Checklist of child tasks (GitHub sub-issues) with an inline "add" field. */
export function SubtaskList({
  tasks,
  onAdd,
  title
}: {
  tasks: Task[]
  onAdd(title: string): Promise<unknown>
  title?: string
}): ReactNode {
  const { t, duration } = useI18n()
  const [text, setText] = useState('')
  const add = useAction(async () => {
    const value = text.trim()
    if (!value) return
    await onAdd(value)
    setText('')
  })
  const done = tasks.filter((x) => x.status === 'closed').length
  const sorted = [...tasks].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.number - b.number)

  return (
    <section className="box">
      <div className="box-header">
        <IssueTracksIcon />
        <h2 className="box-title grow">
          {title ?? t('subtasks.title')} <CounterLabel>{tasks.length}</CounterLabel>
        </h2>
        {tasks.length > 0 && (
          <span className="row small muted nowrap">
            {t('subtasks.done', { done, total: tasks.length })}
            <MiniProgress value={done / tasks.length} />
          </span>
        )}
      </div>
      {sorted.map((task) => (
        <div key={task.id} className={`box-row hoverable subtask-row ${task.status}`} style={{ alignItems: 'center' }}>
          <Checkbox
            checked={task.status === 'closed'}
            onChange={() => void api.updateTask(task.id, { status: task.status === 'open' ? 'closed' : 'open' })}
            aria-label={task.title}
          />
          <Link to={`/tasks/${task.number}`} className="grow link-plain subtask-title">
            {task.title} <span className="muted">#{task.number}</span>
          </Link>
          {task.trackedMs > 0 && (
            <span className="row small muted nowrap" style={{ gap: 4 }}>
              <ClockIcon size={12} />
              {duration(task.trackedMs)}
            </span>
          )}
          {task.status === 'open' && <TimerButton task={task} />}
        </div>
      ))}
      <form
        className="box-footer"
        onSubmit={(e) => {
          e.preventDefault()
          void add.run()
        }}
      >
        <ErrorFlash error={add.error} />
        <TextInput
          block
          leadingVisual={PlusIcon}
          value={text}
          placeholder={t('subtasks.add')}
          aria-label={t('subtasks.add')}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </section>
  )
}
