import { useState, type ReactNode } from 'react'
import { ActionList, ActionMenu, Select, TextInput, Textarea } from '@primer/react'
import { TagIcon } from '@primer/octicons-react'
import type { ID, Label, Priority, TaskInput } from '@shared/types'
import { useApp } from '../context'
import { useI18n, type MessageKey } from '../i18n'
import { Field, LabelToken, Markdown } from './common'

/** GitHub's Write / Preview comment editor. */
export function MarkdownEditor({
  value,
  onChange,
  rows = 8,
  autoFocus
}: {
  value: string
  onChange(value: string): void
  rows?: number
  autoFocus?: boolean
}): ReactNode {
  const { t } = useI18n()
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  return (
    <div>
      <div className="editor-tabs" role="tablist">
        <button type="button" role="tab" className={tab === 'write' ? 'selected' : ''} onClick={() => setTab('write')}>
          {t('task.write')}
        </button>
        <button type="button" role="tab" className={tab === 'preview' ? 'selected' : ''} onClick={() => setTab('preview')}>
          {t('task.preview')}
        </button>
      </div>
      {tab === 'write' ? (
        <Textarea
          block
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('task.bodyPlaceholder')}
          autoFocus={autoFocus}
          resize="vertical"
        />
      ) : (
        <div className="preview-pane">{value.trim() ? <Markdown source={value} /> : <p className="muted m-0">{t('task.nothingToPreview')}</p>}</div>
      )}
    </div>
  )
}

export function LabelSelect({ value, onChange, label }: { value: ID[]; onChange(ids: ID[]): void; label?: string }): ReactNode {
  const { labels } = useApp()
  const { t } = useI18n()
  const toggle = (id: ID): void => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <ActionMenu>
      <ActionMenu.Button leadingVisual={TagIcon} size="small">
        {label ?? t('task.labels')}
      </ActionMenu.Button>
      <ActionMenu.Overlay width="medium">
        <ActionList selectionVariant="multiple">
          {labels.map((l) => (
            <ActionList.Item key={l.id} selected={value.includes(l.id)} onSelect={() => toggle(l.id)}>
              <ActionList.LeadingVisual>
                <span className="color-dot" style={{ background: l.color }} />
              </ActionList.LeadingVisual>
              {l.name}
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

export function SelectedLabels({ ids }: { ids: ID[] }): ReactNode {
  const { labelById } = useApp()
  return (
    <>
      {ids
        .map((id) => labelById.get(id))
        .filter((l): l is Label => l != null)
        .map((l) => (
          <LabelToken key={l.id} label={l} />
        ))}
    </>
  )
}

export function ProjectSelect({ value, onChange, block }: { value: ID | null; onChange(id: ID | null): void; block?: boolean }): ReactNode {
  const { projects } = useApp()
  const { t } = useI18n()
  return (
    <Select block={block} value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <Select.Option value="">{t('task.noProject')}</Select.Option>
      {projects
        .filter((p) => !p.archived || p.id === value)
        .map((p) => (
          <Select.Option key={p.id} value={String(p.id)}>
            {p.name}
          </Select.Option>
        ))}
    </Select>
  )
}

export function PrioritySelect({ value, onChange, block }: { value: Priority; onChange(p: Priority): void; block?: boolean }): ReactNode {
  const { t } = useI18n()
  return (
    <Select block={block} value={String(value)} onChange={(e) => onChange(Number(e.target.value) as Priority)}>
      {([0, 1, 2, 3] as const).map((p) => (
        <Select.Option key={p} value={String(p)}>
          {t(`priority.${p}` as MessageKey)}
        </Select.Option>
      ))}
    </Select>
  )
}

export function TaskForm({ value, onChange, onSubmit }: { value: TaskInput; onChange(v: TaskInput): void; onSubmit?(): void }): ReactNode {
  const { t } = useI18n()
  const set = <K extends keyof TaskInput>(key: K, v: TaskInput[K]): void => onChange({ ...value, [key]: v })
  return (
    <div className="stack">
      <Field label={t('task.title')}>
        <TextInput
          block
          autoFocus
          value={value.title}
          placeholder={t('task.titlePlaceholder')}
          onChange={(e) => set('title', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
      </Field>
      <div className="form-field">
        <span className="form-label">{t('task.body')}</span>
        <MarkdownEditor value={value.body ?? ''} onChange={(v) => set('body', v)} rows={6} />
      </div>
      <div className="form-grid">
        <Field label={t('task.project')}>
          <ProjectSelect block value={value.projectId ?? null} onChange={(v) => set('projectId', v)} />
        </Field>
        <Field label={t('task.priority')}>
          <PrioritySelect block value={value.priority ?? 0} onChange={(v) => set('priority', v)} />
        </Field>
        <Field label={t('task.plannedDate')}>
          <TextInput block type="date" value={value.plannedDate ?? ''} onChange={(e) => set('plannedDate', e.target.value || null)} />
        </Field>
        <Field label={t('task.dueDate')}>
          <TextInput block type="date" value={value.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
        </Field>
        <Field label={t('task.estimate')}>
          <TextInput
            block
            type="number"
            min={0}
            step={5}
            value={value.estimateMin ?? ''}
            trailingVisual={t('common.min')}
            onChange={(e) => set('estimateMin', e.target.value ? Math.max(0, Number(e.target.value)) : null)}
          />
        </Field>
        <div className="form-field">
          <span className="form-label">{t('task.labels')}</span>
          <div className="row row-wrap">
            <LabelSelect value={value.labelIds ?? []} onChange={(v) => set('labelIds', v)} />
            <SelectedLabels ids={value.labelIds ?? []} />
          </div>
        </div>
      </div>
    </div>
  )
}
