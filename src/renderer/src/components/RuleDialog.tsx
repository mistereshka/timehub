import { useState, type ReactNode } from 'react'
import { Dialog, SegmentedControl, Select, TextInput } from '@primer/react'
import type { ID } from '@shared/types'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { categoryName } from '../utils'
import { ErrorFlash, Field } from './common'

export function RuleDialog({ onClose }: { onClose(): void }): ReactNode {
  const { apps, categories } = useApp()
  const { t } = useI18n()
  const tasks = useQuery(() => api.listTasks({ status: 'open' }), [])
  const [appId, setAppId] = useState<ID | null>(null)
  const [pattern, setPattern] = useState('')
  const [target, setTarget] = useState<'category' | 'task'>('category')
  const [categoryId, setCategoryId] = useState<ID | null>(categories[0]?.id ?? null)
  const [taskId, setTaskId] = useState<ID | null>(null)
  const valid = (appId != null || pattern.trim() !== '') && (target === 'category' ? categoryId != null : taskId != null)
  const save = useAction(async () => {
    await api.saveRule({
      appId,
      titlePattern: pattern,
      taskId: target === 'task' ? taskId : null,
      categoryId: target === 'category' ? categoryId : null
    })
    onClose()
  })

  return (
    <Dialog
      title={t('rules.newTitle')}
      width="large"
      onClose={onClose}
      footerButtons={[
        { content: t('common.cancel'), onClick: onClose },
        { content: t('common.save'), buttonType: 'primary', disabled: !valid || save.busy, onClick: () => void save.run() }
      ]}
    >
      <div className="stack">
        <ErrorFlash error={save.error} />
        <p className="muted m-0">{t('rules.intro')}</p>
        <Field label={t('rules.app')}>
          <Select block value={appId == null ? '' : String(appId)} onChange={(e) => setAppId(e.target.value ? Number(e.target.value) : null)}>
            <Select.Option value="">{t('rules.anyApp')}</Select.Option>
            {apps.map((a) => (
              <Select.Option key={a.id} value={String(a.id)}>
                {a.displayName}
              </Select.Option>
            ))}
          </Select>
        </Field>
        <Field label={t('rules.pattern')} hint={t('rules.patternHint')}>
          <TextInput block value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="timehub · /youtube|twitch/" />
        </Field>
        <div className="form-field">
          <span className="form-label">{t('rules.then')}</span>
          <SegmentedControl aria-label={t('rules.then')} size="small" onChange={(i) => setTarget(i === 0 ? 'category' : 'task')}>
            <SegmentedControl.Button selected={target === 'category'}>{t('rules.setCategory')}</SegmentedControl.Button>
            <SegmentedControl.Button selected={target === 'task'}>{t('rules.trackTask')}</SegmentedControl.Button>
          </SegmentedControl>
        </div>
        {target === 'category' ? (
          <Field label={t('activity.category')}>
            <Select block value={String(categoryId ?? '')} onChange={(e) => setCategoryId(Number(e.target.value))}>
              {categories.map((c) => (
                <Select.Option key={c.id} value={String(c.id)}>
                  {categoryName(c, t)}
                </Select.Option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t('rules.task')} hint={t('rules.taskHint')}>
            <Select block value={taskId == null ? '' : String(taskId)} onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : null)}>
              <Select.Option value="">—</Select.Option>
              {(tasks.data ?? []).map((task) => (
                <Select.Option key={task.id} value={String(task.id)}>
                  #{task.number} {task.title}
                </Select.Option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  )
}
