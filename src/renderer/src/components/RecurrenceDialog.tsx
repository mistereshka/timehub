import { useState, type ReactNode } from 'react'
import { Button, Dialog, SegmentedControl, TextInput, Textarea, useConfirm } from '@primer/react'
import type { Recurrence, RecurrenceInput, RecurrenceRule } from '@shared/types'
import { todayKey } from '@shared/time'
import { api } from '../api'
import { useAction } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { clamp, weekdayName } from '../utils'
import { ErrorFlash, Field } from './common'
import { LabelSelect, ProjectSelect, SelectedLabels } from './TaskForm'

const RULES: RecurrenceRule[] = ['daily', 'weekdays', 'weekly', 'monthly']

export function RecurrenceDialog({ recurrence, onClose }: { recurrence: Recurrence | null; onClose(): void }): ReactNode {
  const i18n = useI18n()
  const { t } = i18n
  const confirm = useConfirm()
  const [form, setForm] = useState<RecurrenceInput>(() =>
    recurrence
      ? {
          id: recurrence.id, title: recurrence.title, body: recurrence.body, rule: recurrence.rule, daysMask: recurrence.daysMask,
          dayOfMonth: recurrence.dayOfMonth, projectId: recurrence.projectId, labelIds: recurrence.labelIds,
          estimateMin: recurrence.estimateMin, active: recurrence.active, startDate: recurrence.startDate
        }
      : {
          title: '', body: '', rule: 'daily', daysMask: 0b0010101, dayOfMonth: new Date().getDate(), projectId: null,
          labelIds: [], estimateMin: null, active: true, startDate: todayKey()
        }
  )
  const set = <K extends keyof RecurrenceInput>(key: K, v: RecurrenceInput[K]): void => setForm((f) => ({ ...f, [key]: v }))
  const save = useAction(async () => {
    await api.saveRecurrence(form)
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
      width="large"
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
        <div className="form-field">
          <span className="form-label">{t('recDialog.repeat')}</span>
          <SegmentedControl aria-label={t('recDialog.repeat')} size="small" onChange={(i) => set('rule', RULES[i])}>
            {RULES.map((r) => (
              <SegmentedControl.Button key={r} selected={form.rule === r}>
                {t(`rule.${r}` as MessageKey)}
              </SegmentedControl.Button>
            ))}
          </SegmentedControl>
        </div>
        {form.rule === 'weekly' && (
          <div className="form-field">
            <span className="form-label">{t('recDialog.days')}</span>
            <div className="row row-wrap">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                const on = ((form.daysMask ?? 0) & (1 << i)) !== 0
                return (
                  <Button key={i} size="small" variant={on ? 'primary' : 'default'} onClick={() => set('daysMask', (form.daysMask ?? 0) ^ (1 << i))}>
                    {weekdayName(i, i18n)}
                  </Button>
                )
              })}
            </div>
          </div>
        )}
        {form.rule === 'monthly' && (
          <Field label={t('recDialog.dayOfMonth')}>
            <TextInput
              type="number"
              min={1}
              max={31}
              value={form.dayOfMonth ?? 1}
              onChange={(e) => set('dayOfMonth', clamp(Number(e.target.value) || 1, 1, 31))}
            />
          </Field>
        )}
        <div className="form-grid">
          <Field label={t('task.project')}>
            <ProjectSelect block value={form.projectId ?? null} onChange={(v) => set('projectId', v)} />
          </Field>
          <Field label={t('task.estimate')}>
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
          <Field label={t('recDialog.startDate')}>
            <TextInput block type="date" value={form.startDate ?? todayKey()} onChange={(e) => set('startDate', e.target.value || todayKey())} />
          </Field>
          <div className="form-field">
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
