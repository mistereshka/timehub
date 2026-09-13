import { useEffect, useState, type ReactNode } from 'react'
import { ActionList, ActionMenu, Button, IconButton, StateLabel, TextInput, Timeline, useConfirm } from '@primer/react'
import {
  IssueClosedIcon, IssueOpenedIcon, IssueReopenedIcon, IssueTracksIcon, KebabHorizontalIcon, PencilIcon, PlusIcon, StopwatchIcon,
  SyncIcon, TrashIcon, ZapIcon
} from '@primer/octicons-react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Task, TaskPatch, TimeEntry } from '@shared/types'
import { DAY, HOUR, MINUTE, dayKey, formatHM, todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useNow, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { combineDateTime, dayLabel, ruleText, taskProgress, timeInputValue } from '../utils'
import { Blankslate, ErrorFlash, Markdown, MiniProgress, Progress, ProgressSlider, StreakBadge, TaskLabels } from '../components/common'
import { GoalSelect, LabelSelect, MarkdownEditor, PrioritySelect, ProjectSelect } from '../components/TaskForm'
import { SubtaskList } from '../components/SubtaskList'
import { TimerButton } from '../components/TimerButton'

export function TaskPage(): ReactNode {
  const { number } = useParams()
  const { t } = useI18n()
  const task = useQuery(() => api.getTaskByNumber(Number(number)), [number], ['tasks', 'time'])
  if (!task.data) {
    if (task.loading) return null
    return (
      <div className="container container-narrow">
        <Blankslate icon={<IssueOpenedIcon size={24} />} title={t('task.notFound')}>
          <p>
            <Link to="/tasks">{t('task.backToTasks')}</Link>
          </p>
        </Blankslate>
      </div>
    )
  }
  return <TaskView key={task.data.id} task={task.data} />
}

function TaskView({ task }: { task: Task }): ReactNode {
  const { openNewTask } = useApp()
  const i18n = useI18n()
  const { t, tn, ago, duration } = i18n
  const navigate = useNavigate()
  const confirm = useConfirm()
  const entries = useQuery(() => api.listTimeEntries({ taskId: task.id }), [task.id], ['time'])
  const subtasks = useQuery(() => api.listTasks({ parentId: task.id }), [task.id], ['tasks'])
  const parent = useQuery(async () => (task.parentId != null ? api.getTask(task.parentId) : null), [task.parentId], ['tasks'])
  const recurrence = useQuery(
    async () => (task.recurrenceId == null ? null : ((await api.listRecurrences()).find((r) => r.id === task.recurrenceId) ?? null)),
    [task.recurrenceId],
    ['meta']
  )
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [editingBody, setEditingBody] = useState(false)
  const [body, setBody] = useState(task.body)
  const update = useAction((patch: TaskPatch) => api.updateTask(task.id, patch))
  const list = entries.data ?? []
  const estimateMs = (task.estimateMin ?? 0) * MINUTE
  const progress = taskProgress(task)

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: t('task.deleteTitle'),
      content: t('task.deleteConfirm'),
      confirmButtonType: 'danger',
      confirmButtonContent: t('common.delete')
    })
    if (!ok) return
    await api.deleteTask(task.id)
    navigate('/tasks')
  }

  return (
    <div className="container">
      <div className="task-head">
        {parent.data && (
          <div className="small muted mb-2 row" style={{ gap: 4 }}>
            <IssueTracksIcon size={12} />
            {t('task.parent')}{' '}
            <Link to={`/tasks/${parent.data.number}`}>
              #{parent.data.number} {parent.data.title}
            </Link>
          </div>
        )}
        {editingTitle ? (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await update.run({ title })) setEditingTitle(false)
            }}
          >
            <div className="grow">
              <TextInput block size="large" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('task.title')} />
            </div>
            <Button type="submit" disabled={!title.trim()}>
              {t('common.save')}
            </Button>
            <Button variant="invisible" onClick={() => setEditingTitle(false)}>
              {t('common.cancel')}
            </Button>
          </form>
        ) : (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <h1 className="task-title grow">
              {task.title} <span className="muted">#{task.number}</span> <StreakBadge n={task.streak} title={t('task.streakTitle')} />
            </h1>
            <Button
              size="small"
              onClick={() => {
                setTitle(task.title)
                setEditingTitle(true)
              }}
            >
              {t('common.edit')}
            </Button>
            <Button size="small" variant="primary" onClick={() => openNewTask()}>
              {t('tasks.new')}
            </Button>
          </div>
        )}
        <div className="row row-wrap mt-2">
          <StateLabel status={task.status === 'open' ? 'issueOpened' : 'issueClosed'}>
            {t(task.status === 'open' ? 'task.stateOpen' : 'task.stateClosed')}
          </StateLabel>
          <span className="muted">
            {task.status === 'closed' && task.closedAt ? t('task.closedAgo', { ago: ago(task.closedAt) }) : t('task.openedAgo', { ago: ago(task.createdAt) })}
            {' · '}
            {t('task.trackedTotal', { time: duration(task.trackedMs) })} · {tn('task.entries', list.length)}
          </span>
        </div>
      </div>

      <div className="layout-sidebar mt-3">
        <div className="stack">
          <ErrorFlash error={update.error} />
          <div className="comment-box">
            <div className="comment-box-header">
              <span className="grow">{t('task.body')}</span>
              {!editingBody && (
                <IconButton
                  icon={PencilIcon}
                  size="small"
                  variant="invisible"
                  aria-label={t('common.edit')}
                  onClick={() => {
                    setBody(task.body)
                    setEditingBody(true)
                  }}
                />
              )}
            </div>
            <div className="comment-box-body">
              {editingBody ? (
                <div className="stack stack-sm">
                  <MarkdownEditor value={body} onChange={setBody} autoFocus rows={10} />
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <Button onClick={() => setEditingBody(false)}>{t('common.cancel')}</Button>
                    <Button
                      variant="primary"
                      onClick={async () => {
                        if (await update.run({ body })) setEditingBody(false)
                      }}
                    >
                      {t('common.save')}
                    </Button>
                  </div>
                </div>
              ) : task.body.trim() ? (
                <Markdown source={task.body} />
              ) : (
                <p className="muted m-0">
                  <em>{t('task.noDescription')}</em>
                </p>
              )}
            </div>
          </div>

          <SubtaskList tasks={subtasks.data ?? []} onAdd={(value) => api.createTask({ title: value, parentId: task.id })} />
          <TimeLog entries={list} />
          <AddEntry taskId={task.id} />

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {task.status === 'open' ? (
              <Button leadingVisual={IssueClosedIcon} onClick={() => void update.run({ status: 'closed' })}>
                {t('task.close')}
              </Button>
            ) : (
              <Button leadingVisual={IssueReopenedIcon} onClick={() => void update.run({ status: 'open' })}>
                {t('task.reopen')}
              </Button>
            )}
          </div>
        </div>

        <aside>
          <div className="sidebar-section">
            <TimerButton task={task} full />
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">
              {t('task.completion')}
              {task.progress != null && (
                <button type="button" className="link-button small" onClick={() => void update.run({ progress: null })}>
                  {t('task.auto')}
                </button>
              )}
            </div>
            {task.progress == null && task.childCount > 0 ? (
              <div className="stack stack-sm">
                <div className="row small">
                  <span className="grow muted">{t('task.autoProgress', { done: task.childDone, total: task.childCount })}</span>
                  <span className="bold">{progress}%</span>
                </div>
                <MiniProgress value={(progress ?? 0) / 100} />
              </div>
            ) : (
              <ProgressSlider value={progress ?? 0} disabled={task.status === 'closed'} onCommit={(v) => void update.run({ progress: v })} />
            )}
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">
              {t('task.labels')}
              <LabelSelect value={task.labelIds} onChange={(ids) => void update.run({ labelIds: ids })} label={t('common.edit')} />
            </div>
            {task.labelIds.length ? <TaskLabels ids={task.labelIds} /> : <span className="small muted">{t('task.noLabels')}</span>}
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">{t('task.goal')}</div>
            <GoalSelect block value={task.goalId} onChange={(id) => void update.run({ goalId: id })} />
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">{t('task.project')}</div>
            <ProjectSelect block value={task.projectId} onChange={(id) => void update.run({ projectId: id })} />
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">{t('task.plannedDate')}</div>
            <div className="row">
              <TextInput block type="date" value={task.plannedDate ?? ''} onChange={(e) => void update.run({ plannedDate: e.target.value || null })} />
              <TextInput
                type="time"
                value={task.plannedTime ?? ''}
                aria-label={t('task.plannedTime')}
                onChange={(e) => void update.run({ plannedTime: e.target.value || null })}
              />
            </div>
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">{t('task.dueDate')}</div>
            <TextInput block type="date" value={task.dueDate ?? ''} onChange={(e) => void update.run({ dueDate: e.target.value || null })} />
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">{t('task.priority')}</div>
            <PrioritySelect block value={task.priority} onChange={(p) => void update.run({ priority: p })} />
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">{t('task.estimate')}</div>
            <EstimateInput value={task.estimateMin} onSave={(m) => void update.run({ estimateMin: m })} />
            {estimateMs > 0 && (
              <div className="stack stack-sm mt-2">
                <Progress value={task.trackedMs / estimateMs} color={task.trackedMs > estimateMs ? 'var(--bgColor-danger-emphasis)' : undefined} />
                <span className="small muted">{t('task.progress', { tracked: duration(task.trackedMs), estimate: duration(estimateMs) })}</span>
              </div>
            )}
          </div>
          {recurrence.data && (
            <div className="sidebar-section">
              <div className="sidebar-heading">{t('task.recurrence')}</div>
              <Link to="/plan" className="row small link-plain">
                <SyncIcon size={14} />
                {ruleText(recurrence.data, i18n)}
                {recurrence.data.timeOfDay ? ` · ${recurrence.data.timeOfDay}` : ''}
              </Link>
              {recurrence.data.completeOnTarget && <div className="small muted mt-2">{t('plan.autoComplete')}</div>}
            </div>
          )}
          <div className="sidebar-section">
            <Button variant="invisible" leadingVisual={TrashIcon} onClick={() => void remove()}>
              <span className="fg-danger">{t('task.delete')}</span>
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function EstimateInput({ value, onSave }: { value: number | null; onSave(minutes: number | null): void }): ReactNode {
  const { t } = useI18n()
  const [text, setText] = useState(value?.toString() ?? '')
  useEffect(() => setText(value?.toString() ?? ''), [value])
  const commit = (): void => {
    const n = text.trim() ? Math.max(0, Math.round(Number(text))) : null
    if (n !== value && (n == null || Number.isFinite(n))) onSave(n)
  }
  return (
    <TextInput
      block
      type="number"
      min={0}
      step={5}
      value={text}
      trailingVisual={t('common.min')}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

function TimeLog({ entries }: { entries: TimeEntry[] }): ReactNode {
  const { t } = useI18n()
  const now = useNow(1000)
  return (
    <section>
      <h2 className="section-title">{t('task.timeLog')}</h2>
      {entries.length === 0 ? (
        <div className="box box-body small muted">{t('task.noEntries')}</div>
      ) : (
        <Timeline>
          {entries.map((e) => (
            <EntryItem key={e.id} entry={e} now={now} />
          ))}
        </Timeline>
      )}
    </section>
  )
}

function EntryItem({ entry: e, now }: { entry: TimeEntry; now: number }): ReactNode {
  const i18n = useI18n()
  const { t, duration } = i18n
  const [editing, setEditing] = useState(false)
  const running = e.end == null
  const end = e.end ?? now
  const icon = running ? <StopwatchIcon className="fg-danger" /> : e.source === 'rule' ? <ZapIcon /> : e.source === 'manual' ? <PencilIcon /> : <StopwatchIcon />
  return (
    <Timeline.Item condensed>
      <Timeline.Badge>{icon}</Timeline.Badge>
      <Timeline.Body>
        {editing ? (
          <EntryEditor entry={e} onDone={() => setEditing(false)} />
        ) : (
          <div className="row">
            <span className="grow">
              <strong>{duration(end - e.start, running)}</strong> · {dayLabel(dayKey(e.start), i18n, 'd MMM')} {formatHM(e.start)}–
              {running ? t('task.now') : formatHM(end)} · <span className="muted">{t(`task.source.${e.source}` as MessageKey)}</span>
              {e.note && <span className="muted"> — {e.note}</span>}
            </span>
            {!running && (
              <ActionMenu>
                <ActionMenu.Anchor>
                  <IconButton icon={KebabHorizontalIcon} size="small" variant="invisible" aria-label={t('common.more')} />
                </ActionMenu.Anchor>
                <ActionMenu.Overlay>
                  <ActionList>
                    <ActionList.Item onSelect={() => setEditing(true)}>
                      <ActionList.LeadingVisual>
                        <PencilIcon />
                      </ActionList.LeadingVisual>
                      {t('common.edit')}
                    </ActionList.Item>
                    <ActionList.Item variant="danger" onSelect={() => void api.deleteTimeEntry(e.id)}>
                      <ActionList.LeadingVisual>
                        <TrashIcon />
                      </ActionList.LeadingVisual>
                      {t('common.delete')}
                    </ActionList.Item>
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
            )}
          </div>
        )}
      </Timeline.Body>
    </Timeline.Item>
  )
}

interface EntryValues {
  day: string
  from: string
  to: string
  note: string
}

function toSpan(v: EntryValues): { start: number; end: number } {
  const start = combineDateTime(v.day, v.from)
  let end = combineDateTime(v.day, v.to)
  if (end <= start) end += DAY // e.g. 23:00–01:00
  return { start, end }
}

function EntryForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial: EntryValues
  submitLabel: string
  onSubmit(v: EntryValues): void
  onCancel?(): void
}): ReactNode {
  const { t } = useI18n()
  const [v, setV] = useState(initial)
  const set = (key: keyof EntryValues, value: string): void => setV((x) => ({ ...x, [key]: value }))
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(v)
      }}
    >
      <TextInput type="date" value={v.day} onChange={(e) => set('day', e.target.value)} aria-label={t('task.entryDay')} required />
      <TextInput type="time" value={v.from} onChange={(e) => set('from', e.target.value)} aria-label={t('task.entryFrom')} required />
      <span className="muted">–</span>
      <TextInput type="time" value={v.to} onChange={(e) => set('to', e.target.value)} aria-label={t('task.entryTo')} required />
      <div className="grow">
        <TextInput block value={v.note} placeholder={t('task.entryNote')} aria-label={t('task.entryNote')} onChange={(e) => set('note', e.target.value)} />
      </div>
      <Button type="submit">{submitLabel}</Button>
      {onCancel && (
        <Button variant="invisible" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      )}
    </form>
  )
}

function EntryEditor({ entry, onDone }: { entry: TimeEntry; onDone(): void }): ReactNode {
  const { t } = useI18n()
  const save = useAction(async (v: EntryValues) => {
    await api.updateTimeEntry(entry.id, { ...toSpan(v), note: v.note })
    onDone()
  })
  return (
    <div className="stack stack-sm">
      <ErrorFlash error={save.error} />
      <EntryForm
        initial={{ day: dayKey(entry.start), from: timeInputValue(entry.start), to: timeInputValue(entry.end ?? Date.now()), note: entry.note }}
        submitLabel={t('common.save')}
        onSubmit={(v) => void save.run(v)}
        onCancel={onDone}
      />
    </div>
  )
}

function AddEntry({ taskId }: { taskId: number }): ReactNode {
  const { t } = useI18n()
  const [formKey, setFormKey] = useState(0)
  const add = useAction(async (v: EntryValues) => {
    await api.addTimeEntry({ taskId, ...toSpan(v), note: v.note })
    setFormKey((k) => k + 1)
  })
  const now = Date.now()
  return (
    <div className="box">
      <div className="box-header">
        <PlusIcon />
        <h2 className="box-title">{t('task.addEntry')}</h2>
      </div>
      <div className="box-body">
        <ErrorFlash error={add.error} />
        <EntryForm
          key={formKey}
          initial={{ day: todayKey(), from: timeInputValue(now - HOUR), to: timeInputValue(now), note: '' }}
          submitLabel={t('common.add')}
          onSubmit={(v) => void add.run(v)}
        />
      </div>
    </div>
  )
}
