import { useState, type ReactNode } from 'react'
import { Dialog, TextInput, Textarea, useConfirm } from '@primer/react'
import type { Recurrence, RecurrenceInput } from '@shared/types'
import { todayKey } from '@shared/time'
import { api } from '../api'
import { useAction } from '../hooks'
import { useI18n } from '../i18n'
import { ErrorFlash, Field } from './common'
import { GoalSelect, LabelSelect, ProjectSelect, SelectedLabels } from './TaskForm'
import { RepeatFields, defaultRepeat, type RepeatValue } from './RepeatFields'

export function RecurrenceDialog({ recurrence, onClose }: { recurrence: Recurrence | null; onClose(): void }): ReactNode {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [form, setForm] = useState<RecurrenceInput>(() =>
    recurrence
      ? {
          id: recurrence.id, title: recurrence.title, body: recurrence.body, rule: recurrence.rule, projectId: recurrence.projectId,
          goalId: recurrence.goalId, labelIds: recurrence.labelIds, estimateMin: recurrence.estimateMin, active: recurrence.active,
          startDate: recurrence.startDate
        }
      : { title: '', body: '', rule: 'daily', projectId: null, goalId: null, labelIds: [], estimateMin: null, active: true, startDate: todayKey() }
  )
  const [repeat, setRepeat] = useState<RepeatValue>(() =>
    recurrence
      ? {
          rule: recurrence.rule, daysMask: recurrence.daysMask, dayOfMonth: recurrence.dayOfMonth ?? new Date().getDate(),
          timeOfDay: recurrence.timeOfDay ?? '', completeOnTarget: recurrence.completeOnTarget
        }
      : defaultRepeat('daily')
  )
  const set = <K extends keyof RecurrenceInput>(key: K, v: RecurrenceInput[K]): void => setForm((f) => ({ ...f, [key]: v }))
  const save = useAction(async () => {
    if (repeat.rule === 'none') return
    await api.saveRecurrence({
      ...form,
      rule: repeat.rule,
      daysMask: repeat.daysMask,
      dayOfMonth: repeat.dayOfMonth,
      timeOfDay: repeat.timeOfDay || null,
      completeOnTarget: repeat.completeOnTarget && !!form.estimateMin
    })
    onClose()
  })
  const remove = useAction(async () => {
    if (!recurrence) return
    const ok = await confirm({
      title: t('recDialog.deleteTitle'),
      content: t('recDialog.deleteConfirm'),
      confirmButtonType: 'danger',
      confirmButtonContent: t('common.delete')
    })
    if (!ok) return
    await api.deleteRecurrence(recurrence.id)
    onClose()
  })

  return (
    <Dialog
      title={recurrence ? t('recDialog.editTitle') : t('recDialog.newTitle')}
      width="xlarge"
      onClose={onClose}
      footerButtons={[
        ...(recurrence ? [{ content: t('common.delete'), buttonType: 'danger' as const, onClick: () => void remove.run() }] : []),
        { content: t('common.cancel'), onClick: onClose },
        { content: t('common.save'), buttonType: 'primary', disabled: !form.title.trim() || save.busy, onClick: () => void save.run() }
      ]}
    >
      <div className="stack">
        <ErrorFlash error={save.error ?? remove.error} />
        <Field label={t('task.title')}>
          <TextInput block autoFocus value={form.title} placeholder={t('recDialog.titlePlaceholder')} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label={t('repeat.duration')}>
            <TextInput
              block
              type="number"
              min={0}
              step={5}
              value={form.estimateMin ?? ''}
              trailingVisual={t('common.min')}
              onChange={(e) => set('estimateMin', e.target.value ? Math.max(0, Number(e.target.value)) : null)}
            />
          </Field>
          <Field label={t('task.goal')}>
            <GoalSelect block value={form.goalId ?? null} onChange={(v) => set('goalId', v)} />
          </Field>
        </div>
        <div className="repeat-box">
          <RepeatFields value={repeat} onChange={setRepeat} estimateMin={form.estimateMin} />
        </div>
        <div className="form-grid">
          <Field label={t('task.project')}>
            <ProjectSelect block value={form.projectId ?? null} onChange={(v) => set('projectId', v)} />
          </Field>
          <Field label={t('recDialog.startDate')}>
            <TextInput block type="date" value={form.startDate ?? todayKey()} onChange={(e) => set('startDate', e.target.value || todayKey())} />
          </Field>
          <div className="form-field span-2">
            <span className="form-label">{t('task.labels')}</span>
            <div className="row row-wrap">
              <LabelSelect value={form.labelIds ?? []} onChange={(v) => set('labelIds', v)} />
              <SelectedLabels ids={form.labelIds ?? []} />
            </div>
          </div>
        </div>
        <Field label={t('task.body')}>
          <Textarea block rows={3} value={form.body ?? ''} onChange={(e) => set('body', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}
