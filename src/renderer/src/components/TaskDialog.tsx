import { useState, type ReactNode } from 'react'
import { Dialog } from '@primer/react'
import { useNavigate } from 'react-router'
import type { TaskInput } from '@shared/types'
import { todayKey } from '@shared/time'
import { api } from '../api'
import { useAction } from '../hooks'
import { useI18n } from '../i18n'
import { ErrorFlash } from './common'
import { RepeatFields, defaultRepeat } from './RepeatFields'
import { TaskForm } from './TaskForm'

/** New task — or, with "Repeat" set, a recurring task (e.g. English every Tue and Fri, 2 hours). */
export function TaskDialog({ defaults, onClose }: { defaults: Partial<TaskInput>; onClose(): void }): ReactNode {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [form, setForm] = useState<TaskInput>({
    title: '', body: '', labelIds: [], projectId: null, priority: 0, plannedDate: null, plannedTime: null, dueDate: null,
    estimateMin: null, goalId: null, ...defaults
  })
  const [repeat, setRepeat] = useState(defaultRepeat)
  const repeating = repeat.rule !== 'none'
  const create = useAction(async () => {
    if (repeat.rule !== 'none') {
      await api.saveRecurrence({
        title: form.title, body: form.body, rule: repeat.rule, daysMask: repeat.daysMask, dayOfMonth: repeat.dayOfMonth,
        timeOfDay: repeat.timeOfDay || null, completeOnTarget: repeat.completeOnTarget && !!form.estimateMin,
        projectId: form.projectId, goalId: form.goalId, labelIds: form.labelIds, estimateMin: form.estimateMin, startDate: todayKey()
      })
      onClose()
      navigate('/plan')
      return
    }
    const task = await api.createTask(form)
    onClose()
    navigate(`/tasks/${task.number}`)
  })
  const submit = (): void => {
    if (form.title.trim() && !create.busy) void create.run()
  }

  return (
    <Dialog
      title={t('taskDialog.title')}
      width="xlarge"
      onClose={onClose}
      footerButtons={[
        { content: t('common.cancel'), onClick: onClose },
        {
          content: repeating ? t('taskDialog.createRecurring') : t('taskDialog.create'),
          buttonType: 'primary',
          onClick: submit,
          disabled: !form.title.trim() || create.busy
        }
      ]}
    >
      <div className="stack">
        <ErrorFlash error={create.error} />
        <TaskForm value={form} onChange={setForm} onSubmit={submit} repeating={repeating} />
        <div className="repeat-box">
          <RepeatFields value={repeat} onChange={setRepeat} allowNone estimateMin={form.estimateMin} />
          {repeating && <p className="small muted m-0">{t('repeat.hint')}</p>}
        </div>
      </div>
    </Dialog>
  )
}
