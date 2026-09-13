import type { ReactNode } from 'react'
import { Button, Checkbox, SegmentedControl, TextInput } from '@primer/react'
import type { RecurrenceRule } from '@shared/types'
import { MINUTE, todayKey, weekday } from '@shared/time'
import { useI18n, type MessageKey } from '../i18n'
import { clamp, weekdayName } from '../utils'
import { Field } from './common'

export type RepeatRule = RecurrenceRule | 'none'
export interface RepeatValue {
  rule: RepeatRule
  daysMask: number
  dayOfMonth: number
  timeOfDay: string
  completeOnTarget: boolean
}

export const defaultRepeat = (rule: RepeatRule = 'none'): RepeatValue => ({
  rule,
  daysMask: 1 << weekday(todayKey()),
  dayOfMonth: new Date().getDate(),
  timeOfDay: '',
  completeOnTarget: false
})

/** Repeat rule, weekdays, time and "done once the time is reached" — shared by task and recurrence dialogs. */
export function RepeatFields({
  value,
  onChange,
  allowNone = false,
  estimateMin
}: {
  value: RepeatValue
  onChange(v: RepeatValue): void
  allowNone?: boolean
  estimateMin: number | null | undefined
}): ReactNode {
  const i18n = useI18n()
  const { t, duration } = i18n
  const rules: RepeatRule[] = allowNone ? ['none', 'daily', 'weekdays', 'weekly', 'monthly'] : ['daily', 'weekdays', 'weekly', 'monthly']
  const set = <K extends keyof RepeatValue>(key: K, v: RepeatValue[K]): void => onChange({ ...value, [key]: v })
  return (
    <div className="stack stack-sm">
      <div className="form-field">
        <span className="form-label">{t('recDialog.repeat')}</span>
        <SegmentedControl aria-label={t('recDialog.repeat')} size="small" onChange={(i) => set('rule', rules[i])}>
          {rules.map((r) => (
            <SegmentedControl.Button key={r} selected={value.rule === r}>
              {r === 'none' ? t('repeat.none') : t(`rule.${r}` as MessageKey)}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
      </div>
      {value.rule === 'weekly' && (
        <div className="form-field">
          <span className="form-label">{t('recDialog.days')}</span>
          <div className="row row-wrap">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const on = (value.daysMask & (1 << i)) !== 0
              return (
                <Button key={i} size="small" variant={on ? 'primary' : 'default'} onClick={() => set('daysMask', value.daysMask ^ (1 << i))}>
                  {weekdayName(i, i18n)}
                </Button>
              )
            })}
          </div>
        </div>
      )}
      {value.rule === 'monthly' && (
        <Field label={t('recDialog.dayOfMonth')}>
          <TextInput
            type="number"
            min={1}
            max={31}
            value={value.dayOfMonth}
            onChange={(e) => set('dayOfMonth', clamp(Number(e.target.value) || 1, 1, 31))}
          />
        </Field>
      )}
      {value.rule !== 'none' && (
        <div className="form-grid">
          <Field label={t('repeat.time')} hint={t('repeat.timeHint')}>
            <TextInput type="time" value={value.timeOfDay} onChange={(e) => set('timeOfDay', e.target.value)} />
          </Field>
          <label className="check-field">
            <Checkbox
              checked={value.completeOnTarget && !!estimateMin}
              disabled={!estimateMin}
              onChange={(e) => set('completeOnTarget', e.target.checked)}
            />
            <span>
              {estimateMin
                ? t('repeat.completeOnTarget', { time: duration(estimateMin * MINUTE) })
                : t('repeat.completeNeedsEstimate')}
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
