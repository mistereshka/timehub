import { useState, type ReactNode } from 'react'
import { Dialog } from '@primer/react'
import { useNavigate } from 'react-router'
import type { TaskInput } from '@shared/types'
import { api } from '../api'
import { useAction } from '../hooks'
import { useI18n } from '../i18n'
import { ErrorFlash } from './common'
import { TaskForm } from './TaskForm'

export function TaskDialog({ defaults, onClose }: { defaults: Partial<TaskInput>; onClose(): void }): ReactNode {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [form, setForm] = useState<TaskInput>({
    title: '', body: '', labelIds: [], projectId: null, priority: 0, plannedDate: null, dueDate: null, estimateMin: null,
    ...defaults
  })
  const create = useAction(async () => {
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
        { content: t('taskDialog.create'), buttonType: 'primary', onClick: submit, disabled: !form.title.trim() || create.busy }
      ]}
    >
      <ErrorFlash error={create.error} />
      <TaskForm value={form} onChange={setForm} onSubmit={submit} />
    </Dialog>
  )
}
