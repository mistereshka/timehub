import { useEffect, useState, type ReactNode } from 'react'
import { ActionList, ActionMenu, Button, LinkButton, TextInput } from '@primer/react'
import { CheckIcon, FilterIcon, IssueOpenedIcon, RepoIcon, SearchIcon, TagIcon, XIcon } from '@primer/octicons-react'
import { useSearchParams } from 'react-router'
import { TASK_SORTS, filterTasks, parseQuery, setQualifier, toggleQualifier, type TaskSort } from '@shared/search'
import { todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { Blankslate } from '../components/common'
import { TaskRow } from '../components/TaskRow'

const DEFAULT_QUERY = 'is:open '

const PRESETS: { label: MessageKey; q: string }[] = [
  { label: 'tasks.presetOpen', q: 'is:open ' },
  { label: 'tasks.presetToday', q: 'is:open planned:today ' },
  { label: 'tasks.presetOverdue', q: 'is:open due:overdue ' },
  { label: 'tasks.presetWeek', q: 'is:open due:week sort:due-asc ' },
  { label: 'tasks.presetRecurring', q: 'is:recurring ' },
  { label: 'tasks.presetNoProject', q: 'is:open no:project ' },
  { label: 'tasks.presetClosed', q: 'is:closed ' }
]

const SORT_LABELS: Record<TaskSort, MessageKey> = {
  'created-desc': 'tasks.sortNewest',
  'created-asc': 'tasks.sortOldest',
  'updated-desc': 'tasks.sortUpdated',
  'due-asc': 'tasks.sortDue',
  'priority-desc': 'tasks.sortPriority',
  'time-desc': 'tasks.sortTime'
}

/** GitHub Issues-style task list with qualifier search. */
export function TasksPage(): ReactNode {
  const { labels, projects, openNewTask } = useApp()
  const { t, tn } = useI18n()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? DEFAULT_QUERY
  const [input, setInput] = useState(q)
  useEffect(() => setInput(q), [q])
  const setQ = (next: string): void => setParams({ q: next })

  const tasks = useQuery(() => api.listTasks(), [], ['tasks'])
  const query = parseQuery(q)
  const ctx = { labels, projects, today: todayKey() }
  const all = tasks.data ?? []
  const shown = filterTasks(all, query, ctx)
  const counted = filterTasks(all, { ...query, status: 'all' }, ctx)
  const openCount = counted.filter((x) => x.status === 'open').length
  const closedCount = counted.length - openCount

  return (
    <div className="container">
      <div className="row mb-3">
        <ActionMenu>
          <ActionMenu.Button leadingVisual={FilterIcon}>{t('tasks.filters')}</ActionMenu.Button>
          <ActionMenu.Overlay width="medium">
            <ActionList selectionVariant="single">
              {PRESETS.map((p) => (
                <ActionList.Item key={p.label} selected={q.trim() === p.q.trim()} onSelect={() => setQ(p.q)}>
                  {t(p.label)}
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
        <form
          className="grow"
          onSubmit={(e) => {
            e.preventDefault()
            setQ(input)
          }}
        >
          <TextInput block leadingVisual={SearchIcon} value={input} onChange={(e) => setInput(e.target.value)} aria-label={t('tasks.search')} placeholder={t('tasks.search')} />
        </form>
        <LinkButton href="#/labels" leadingVisual={TagIcon} count={labels.length}>
          {t('tasks.labels')}
        </LinkButton>
        <LinkButton href="#/labels?tab=projects" leadingVisual={RepoIcon} count={projects.length}>
          {t('tasks.projects')}
        </LinkButton>
        <Button variant="primary" onClick={() => openNewTask()}>
          {t('tasks.new')}
        </Button>
      </div>

      {q.trim() !== DEFAULT_QUERY.trim() && (
        <div className="mb-2">
          <Button variant="invisible" size="small" leadingVisual={XIcon} onClick={() => setQ(DEFAULT_QUERY)}>
            {t('tasks.clear')}
          </Button>
        </div>
      )}

      <div className="box">
        <div className="box-header">
          <button
            type="button"
            className={`state-toggle${query.status === 'open' ? ' selected' : ''}`}
            onClick={() => setQ(setQualifier(q, 'is', query.status === 'open' ? null : 'open'))}
          >
            <IssueOpenedIcon />
            {tn('tasks.openCount', openCount)}
          </button>
          <button
            type="button"
            className={`state-toggle${query.status === 'closed' ? ' selected' : ''}`}
            onClick={() => setQ(setQualifier(q, 'is', query.status === 'closed' ? null : 'closed'))}
          >
            <CheckIcon />
            {tn('tasks.closedCount', closedCount)}
          </button>
          <span className="grow" />
          <FilterMenu
            title={t('tasks.project')}
            items={projects.map((p) => ({ key: p.name, color: p.color, selected: query.project?.toLowerCase() === p.name.toLowerCase() }))}
            onSelect={(name) => setQ(setQualifier(q, 'project', query.project?.toLowerCase() === name.toLowerCase() ? null : name))}
          />
          <FilterMenu
            multiple
            title={t('tasks.label')}
            items={labels.map((l) => ({ key: l.name, color: l.color, selected: query.labels.some((x) => x.toLowerCase() === l.name.toLowerCase()) }))}
            onSelect={(name) => setQ(toggleQualifier(q, 'label', name))}
          />
          <ActionMenu>
            <ActionMenu.Button variant="invisible" size="small">
              {t('tasks.sort')}
            </ActionMenu.Button>
            <ActionMenu.Overlay width="medium">
              <ActionList selectionVariant="single">
                {TASK_SORTS.map((s) => (
                  <ActionList.Item key={s} selected={query.sort === s} onSelect={() => setQ(setQualifier(q, 'sort', s === 'created-desc' ? null : s))}>
                    {t(SORT_LABELS[s])}
                  </ActionList.Item>
                ))}
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </div>
        {shown.length > 0
          ? shown.map((x) => <TaskRow key={x.id} task={x} />)
          : !tasks.loading && (
              <Blankslate icon={<IssueOpenedIcon size={24} />} title={all.length ? t('tasks.emptyTitle') : t('tasks.noTasksTitle')}>
                <p>{all.length ? t('tasks.emptyText') : t('tasks.noTasksText')}</p>
                {!all.length && (
                  <Button variant="primary" onClick={() => openNewTask()}>
                    {t('tasks.new')}
                  </Button>
                )}
              </Blankslate>
            )}
      </div>
      <p className="small muted mt-2">
        <strong>{t('tasks.protip')}</strong> {t('tasks.protipText')}
      </p>
    </div>
  )
}

function FilterMenu({
  title,
  items,
  onSelect,
  multiple
}: {
  title: string
  items: { key: string; color: string; selected: boolean }[]
  onSelect(key: string): void
  multiple?: boolean
}): ReactNode {
  return (
    <ActionMenu>
      <ActionMenu.Button variant="invisible" size="small">
        {title}
      </ActionMenu.Button>
      <ActionMenu.Overlay width="medium">
        <ActionList selectionVariant={multiple ? 'multiple' : 'single'}>
          {items.length === 0 && <ActionList.Item disabled>—</ActionList.Item>}
          {items.map((i) => (
            <ActionList.Item key={i.key} selected={i.selected} onSelect={() => onSelect(i.key)}>
              <ActionList.LeadingVisual>
                <span className="color-dot" style={{ background: i.color }} />
              </ActionList.LeadingVisual>
              {i.key}
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
