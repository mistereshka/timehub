import { useState, type ReactNode } from 'react'
import { Checkbox, Dialog, TextInput } from '@primer/react'
import type { Goal } from '@shared/types'
import { api } from '../api'
import { useAction } from '../hooks'
import { useI18n } from '../i18n'
import { ColorField, ErrorFlash, Field } from './common'
import { MarkdownEditor } from './TaskForm'

export function GoalDialog({ goal, onClose }: { goal: Goal | null; onClose(saved?: Goal): void }): ReactNode {
  const { t } = useI18n()
  const [title, setTitle] = useState(goal?.title ?? '')
  const [emoji, setEmoji] = useState(goal?.emoji ?? '🎯')
  const [color, setColor] = useState(goal?.color ?? '#1f883d')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [body, setBody] = useState(goal?.body ?? '')
  const [autoProgress, setAutoProgress] = useState(goal?.autoProgress ?? true)
  const [manual, setManual] = useState(goal?.manualProgress ?? 0)
  const save = useAction(async () => {
    const saved = await api.saveGoal({
      id: goal?.id, title, emoji: emoji.trim() || '🎯', color, targetDate: targetDate || null, body, autoProgress, manualProgress: manual
    })
    onClose(saved)
  })

  return (
    <Dialog
      title={goal ? t('goals.edit') : t('goals.new')}
      width="xlarge"
      onClose={() => onClose()}
      footerButtons={[
        { content: t('common.cancel'), onClick: () => onClose() },
        { content: goal ? t('common.save') : t('goals.create'), buttonType: 'primary', disabled: !title.trim() || save.busy, onClick: () => void save.run() }
      ]}
    >
      <div className="stack">
        <ErrorFlash error={save.error} />
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label={t('goals.emoji')}>
            <TextInput className="emoji-input" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} />
          </Field>
          <div className="grow">
            <Field label={t('goals.titleLabel')}>
              <TextInput block autoFocus value={title} placeholder={t('goals.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="form-grid">
          <Field label={t('goals.target')}>
            <TextInput block type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
          <ColorField value={color} onChange={setColor} />
        </div>
        <label className="check-field">
          <Checkbox checked={autoProgress} onChange={(e) => setAutoProgress(e.target.checked)} />
          <span>
            {t('goals.autoProgress')}
            <br />
            <span className="small muted">{t('goals.autoProgressHint')}</span>
          </span>
        </label>
        <div className="form-field">
          <span className="form-label">{t('goals.progressLabel', { n: manual })}</span>
          <input type="range" className="range" min={0} max={100} step={5} value={manual} onChange={(e) => setManual(Number(e.target.value))} />
        </div>
        <div className="form-field">
          <span className="form-label">{t('task.body')}</span>
          <MarkdownEditor value={body} onChange={setBody} rows={5} />
        </div>
      </div>
    </Dialog>
  )
}
