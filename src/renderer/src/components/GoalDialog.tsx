import { useEffect, useState, type ReactNode } from 'react'
import { Button, Checkbox, Dialog, Select, TextInput } from '@primer/react'
import type { Goal, Recurrence } from '@shared/types'
import { MINUTE, todayKey } from '@shared/time'
import { api } from '../api'
import { useAction, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { weekdayName } from '../utils'
import { ColorField, ErrorFlash, Field } from './common'
import { MarkdownEditor } from './TaskForm'

/** How often and how long to work on a goal — saved as a recurring task linked to it. */
interface GoalPlan {
  enabled: boolean
  /** bit 0 = Monday … bit 6 = Sunday */
  daysMask: number
  timeOfDay: string
  minutes: number
  completeOnTarget: boolean
}

const EVERY_DAY = 0x7f
const WEEKDAYS = 0x1f
const MINUTE_OPTIONS = [15, 20, 30, 45, 60, 90, 120, 150, 180, 240]
const NEW_PLAN: GoalPlan = { enabled: false, daysMask: WEEKDAYS, timeOfDay: '', minutes: 30, completeOnTarget: true }

const planOf = (r: Recurrence): GoalPlan => ({
  enabled: true,
  daysMask: r.rule === 'daily' ? EVERY_DAY : r.rule === 'weekdays' ? WEEKDAYS : r.daysMask,
  timeOfDay: r.timeOfDay ?? '',
  minutes: r.estimateMin ?? 30,
  completeOnTarget: r.completeOnTarget
})

export function GoalDialog({ goal, onClose }: { goal: Goal | null; onClose(saved?: Goal): void }): ReactNode {
  const i18n = useI18n()
  const { t, duration } = i18n
  const [title, setTitle] = useState(goal?.title ?? '')
  const [emoji, setEmoji] = useState(goal?.emoji ?? '🎯')
  const [color, setColor] = useState(goal?.color ?? '#8250df')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [body, setBody] = useState(goal?.body ?? '')
  const [autoProgress, setAutoProgress] = useState(goal?.autoProgress ?? true)
  const [manual, setManual] = useState(goal?.manualProgress ?? 0)
  const recurrences = useQuery(() => api.listRecurrences(), [], ['meta'])
  const existing = goal ? ((recurrences.data ?? []).find((r) => r.goalId === goal.id && r.active) ?? null) : null
  const [plan, setPlan] = useState<GoalPlan | null>(goal ? null : NEW_PLAN)
  useEffect(() => {
    if (plan === null && recurrences.data) setPlan(existing ? planOf(existing) : NEW_PLAN)
  }, [plan, recurrences.data, existing])
  const setP = (patch: Partial<GoalPlan>): void => setPlan((p) => ({ ...(p ?? NEW_PLAN), ...patch }))
  const planInvalid = !!plan?.enabled && !(plan.daysMask & EVERY_DAY)

  const save = useAction(async () => {
    const saved = await api.saveGoal({
      id: goal?.id, title, emoji: emoji.trim() || '🎯', color, targetDate: targetDate || null, body, autoProgress, manualProgress: manual
    })
    if (plan?.enabled) {
      await api.saveRecurrence({
        id: existing?.id,
        title: saved.title,
        body: existing?.body ?? '',
        rule: 'weekly',
        daysMask: plan.daysMask,
        dayOfMonth: null,
        timeOfDay: plan.timeOfDay || null,
        completeOnTarget: plan.completeOnTarget,
        estimateMin: plan.minutes,
        goalId: saved.id,
        projectId: existing?.projectId ?? null,
        labelIds: existing?.labelIds ?? [],
        active: true,
        startDate: existing ? undefined : todayKey()
      })
    } else if (existing) {
      await api.saveRecurrence({ ...existing, active: false })
    }
    onClose(saved)
  })

  const minuteOptions = plan && !MINUTE_OPTIONS.includes(plan.minutes) ? [...MINUTE_OPTIONS, plan.minutes].sort((a, b) => a - b) : MINUTE_OPTIONS

  return (
    <Dialog
      title={goal ? t('goals.edit') : t('goals.new')}
      width="xlarge"
      onClose={() => onClose()}
      footerButtons={[
        { content: t('common.cancel'), onClick: () => onClose() },
        {
          content: goal ? t('common.save') : t('goals.create'),
          buttonType: 'primary',
          disabled: !title.trim() || save.busy || planInvalid || plan === null,
          onClick: () => void save.run()
        }
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

        {plan && (
          <div className="repeat-box stack stack-sm">
            <label className="check-field">
              <Checkbox checked={plan.enabled} onChange={(e) => setP({ enabled: e.target.checked })} />
              <span>
                <span className="bold">{t('goals.plan')}</span>
                <br />
                <span className="small muted">{t('goals.planHint')}</span>
              </span>
            </label>
            {plan.enabled && (
              <>
                <div className="form-field">
                  <span className="form-label">{t('recDialog.days')}</span>
                  <div className="row row-wrap">
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                      const on = (plan.daysMask & (1 << i)) !== 0
                      return (
                        <Button key={i} size="small" variant={on ? 'primary' : 'default'} onClick={() => setP({ daysMask: plan.daysMask ^ (1 << i) })}>
                          {weekdayName(i, i18n)}
                        </Button>
                      )
                    })}
                    <Button size="small" variant="invisible" onClick={() => setP({ daysMask: EVERY_DAY })}>
                      {t('rule.daily')}
                    </Button>
                    <Button size="small" variant="invisible" onClick={() => setP({ daysMask: WEEKDAYS })}>
                      {t('rule.weekdays')}
                    </Button>
                  </div>
                  {planInvalid && <span className="small fg-danger">{t('goals.noDays')}</span>}
                </div>
                <div className="form-grid">
                  <Field label={t('goals.perDay')}>
                    <Select block value={String(plan.minutes)} onChange={(e) => setP({ minutes: Number(e.target.value) })}>
                      {minuteOptions.map((m) => (
                        <Select.Option key={m} value={String(m)}>
                          {duration(m * MINUTE)}
                        </Select.Option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('repeat.time')} hint={t('goals.timeHint')}>
                    <TextInput block type="time" value={plan.timeOfDay} onChange={(e) => setP({ timeOfDay: e.target.value })} />
                  </Field>
                </div>
                <label className="check-field">
                  <Checkbox checked={plan.completeOnTarget} onChange={(e) => setP({ completeOnTarget: e.target.checked })} />
                  <span>{t('repeat.completeOnTarget', { time: duration(plan.minutes * MINUTE) })}</span>
                </label>
              </>
            )}
          </div>
        )}

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
