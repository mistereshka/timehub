import type { Label, Priority, Project, Task } from './types'
import { addDays } from './time'

export const TASK_SORTS = ['created-desc', 'created-asc', 'updated-desc', 'due-asc', 'priority-desc', 'time-desc'] as const
export type TaskSort = (typeof TASK_SORTS)[number]

/** GitHub-style issue search: `is:open label:work project:"Home" priority:high sort:due-asc text` */
export interface TaskQuery {
  status: 'open' | 'closed' | 'all'
  labels: string[]
  noLabel: boolean
  project: string | null
  noProject: boolean
  priority: Priority | null
  due: 'overdue' | 'today' | 'week' | null
  planned: 'today' | 'none' | null
  recurring: boolean
  text: string
  sort: TaskSort
}

export const PRIORITY_NAMES = ['none', 'low', 'medium', 'high'] as const

/** Splits on whitespace, keeping "quoted phrases" and key:"quoted values" together. */
export function tokenize(input: string): string[] {
  return [...input.matchAll(/\S+?:"[^"]*"?|"[^"]*"?|\S+/g)].map((m) => m[0])
}

const unquote = (s: string): string => s.replace(/^"|"$/g, '')

export function parseQuery(input: string): TaskQuery {
  const q: TaskQuery = {
    status: 'all', labels: [], noLabel: false, project: null, noProject: false, priority: null,
    due: null, planned: null, recurring: false, text: '', sort: 'created-desc'
  }
  const words: string[] = []
  for (const token of tokenize(input)) {
    const m = /^([a-z]+):(.*)$/i.exec(token)
    if (!m) {
      words.push(unquote(token))
      continue
    }
    const key = m[1].toLowerCase()
    const value = unquote(m[2])
    const v = value.toLowerCase()
    switch (key) {
      case 'is':
        if (v === 'open' || v === 'closed') q.status = v
        else if (v === 'recurring') q.recurring = true
        break
      case 'label':
        if (value) q.labels.push(value)
        break
      case 'no':
        if (v === 'label') q.noLabel = true
        else if (v === 'project') q.noProject = true
        break
      case 'project':
        q.project = value || null
        break
      case 'priority': {
        const p = (PRIORITY_NAMES as readonly string[]).indexOf(v)
        if (p >= 0) q.priority = p as Priority
        break
      }
      case 'due':
        if (v === 'overdue' || v === 'today' || v === 'week') q.due = v
        break
      case 'planned':
        if (v === 'today' || v === 'none') q.planned = v
        break
      case 'sort':
        if ((TASK_SORTS as readonly string[]).includes(v)) q.sort = v as TaskSort
        break
      default:
        words.push(token)
    }
  }
  q.text = words.join(' ').trim()
  return q
}

export interface FilterContext {
  labels: Label[]
  projects: Project[]
  today: string
}

export function filterTasks(tasks: Task[], q: TaskQuery, ctx: FilterContext): Task[] {
  const byName = <T extends { id: number; name: string }>(list: T[], name: string): number =>
    list.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id ?? -1
  const labelIds = q.labels.map((n) => byName(ctx.labels, n))
  const projectId = q.project == null ? null : byName(ctx.projects, q.project)
  const text = q.text.toLowerCase()
  const weekEnd = addDays(ctx.today, 7)

  const matches = (t: Task): boolean => {
    if (q.status !== 'all' && t.status !== q.status) return false
    if (labelIds.some((id) => !t.labelIds.includes(id))) return false
    if (q.noLabel && t.labelIds.length > 0) return false
    if (projectId != null && t.projectId !== projectId) return false
    if (q.noProject && t.projectId != null) return false
    if (q.priority != null && t.priority !== q.priority) return false
    if (q.recurring && t.recurrenceId == null) return false
    if (q.due === 'overdue' && !(t.status === 'open' && t.dueDate != null && t.dueDate < ctx.today)) return false
    if (q.due === 'today' && t.dueDate !== ctx.today) return false
    if (q.due === 'week' && !(t.dueDate != null && t.dueDate >= ctx.today && t.dueDate < weekEnd)) return false
    if (q.planned === 'today' && t.plannedDate !== ctx.today) return false
    if (q.planned === 'none' && t.plannedDate != null) return false
    if (text) {
      const hit = t.title.toLowerCase().includes(text) || t.body.toLowerCase().includes(text) || `#${t.number}` === text
      if (!hit) return false
    }
    return true
  }
  return sortTasks(tasks.filter(matches), q.sort)
}

const COMPARATORS: Record<TaskSort, (a: Task, b: Task) => number> = {
  'created-desc': (a, b) => b.createdAt - a.createdAt,
  'created-asc': (a, b) => a.createdAt - b.createdAt,
  'updated-desc': (a, b) => b.updatedAt - a.updatedAt,
  'due-asc': (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt - a.createdAt,
  'priority-desc': (a, b) => b.priority - a.priority || b.createdAt - a.createdAt,
  'time-desc': (a, b) => b.trackedMs - a.trackedMs || b.createdAt - a.createdAt
}

export const sortTasks = (tasks: Task[], sort: TaskSort): Task[] => [...tasks].sort(COMPARATORS[sort])

const quoteIfNeeded = (value: string): string => (/\s/.test(value) ? `"${value}"` : value)

/**
 * Replaces all `key:` qualifiers in the query with `key:value` (or removes them
 * when value is null). `is:` only touches the open/closed state.
 */
export function setQualifier(input: string, key: string, value: string | null): string {
  const prefix = `${key.toLowerCase()}:`
  const tokens = tokenize(input).filter((t) => {
    const lower = t.toLowerCase()
    if (!lower.startsWith(prefix)) return true
    return key === 'is' && !['is:open', 'is:closed'].includes(lower)
  })
  if (value != null) tokens.unshift(`${key}:${quoteIfNeeded(value)}`)
  return tokens.length ? `${tokens.join(' ')} ` : ''
}

/** Adds `key:value` unless present; removes it if it is (checkbox-like toggle). */
export function toggleQualifier(input: string, key: string, value: string): string {
  const token = `${key}:${quoteIfNeeded(value)}`.toLowerCase()
  const tokens = tokenize(input)
  const kept = tokens.filter((t) => t.toLowerCase() !== token)
  if (kept.length === tokens.length) kept.push(`${key}:${quoteIfNeeded(value)}`)
  return kept.length ? `${kept.join(' ')} ` : ''
}
