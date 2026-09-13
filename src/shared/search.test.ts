import { describe, expect, it } from 'vitest'
import { filterTasks, parseQuery, setQualifier, toggleQualifier, tokenize } from './search'
import type { Label, Project, Task } from './types'

const task = (over: Partial<Task>): Task => ({
  id: 1, number: 1, title: 'Task', body: '', status: 'open', priority: 0, projectId: null, labelIds: [],
  dueDate: null, plannedDate: null, plannedTime: null, estimateMin: null, recurrenceId: null, parentId: null, goalId: null,
  progress: null, childCount: 0, childDone: 0, streak: 0, sortOrder: 0,
  createdAt: 0, updatedAt: 0, closedAt: null, trackedMs: 0, ...over
})

const labels: Label[] = [
  { id: 1, name: 'work', color: '#0075ca', description: '' },
  { id: 2, name: 'Deep Work', color: '#7057ff', description: '' }
]
const projects: Project[] = [{ id: 7, name: 'Home', color: '#0e8a16', description: '', archived: false, createdAt: 0 }]
const ctx = { labels, projects, today: '2026-09-13' }

const tasks = [
  task({ id: 1, number: 1, title: 'Write report', labelIds: [1] }),
  task({ id: 2, number: 2, status: 'closed', labelIds: [1, 2] }),
  task({ id: 3, number: 3, projectId: 7, dueDate: '2026-09-01', priority: 3 })
]
const numbers = (q: string): number[] => filterTasks(tasks, parseQuery(q), ctx).map((t) => t.number)

describe('task search', () => {
  it('tokenizes quoted values', () => {
    expect(tokenize('is:open label:"deep work" "exact phrase" x')).toEqual(['is:open', 'label:"deep work"', '"exact phrase"', 'x'])
  })

  it('parses GitHub-style qualifiers', () => {
    expect(parseQuery('is:open label:"deep work" project:Home priority:high due:overdue sort:due-asc write report')).toMatchObject({
      status: 'open', labels: ['deep work'], project: 'Home', priority: 3, due: 'overdue', sort: 'due-asc', text: 'write report'
    })
  })

  it('filters by state, labels, project, due date and text', () => {
    expect(numbers('is:open label:work')).toEqual([1])
    expect(numbers('label:"deep work"')).toEqual([2])
    expect(numbers('project:home due:overdue')).toEqual([3])
    expect(numbers('priority:high')).toEqual([3])
    expect(numbers('report')).toEqual([1])
    expect(numbers('#3')).toEqual([3])
    expect(numbers('label:missing')).toEqual([])
    expect(numbers('no:label')).toEqual([3])
  })

  it('edits qualifiers in the query string', () => {
    expect(setQualifier('is:open label:work foo', 'is', 'closed')).toBe('is:closed label:work foo ')
    expect(setQualifier('is:open is:recurring', 'is', null)).toBe('is:recurring ')
    expect(toggleQualifier('is:open ', 'label', 'deep work')).toBe('is:open label:"deep work" ')
    expect(toggleQualifier('is:open label:"deep work"', 'label', 'deep work')).toBe('is:open ')
  })
})
