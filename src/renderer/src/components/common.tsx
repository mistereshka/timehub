import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Flash, IssueLabelToken, Label as PrimerLabel, TextInput } from '@primer/react'
import { IssueClosedIcon, IssueOpenedIcon } from '@primer/octicons-react'
import type { Label, Priority, Project, Task, UsageItem } from '@shared/types'
import { COLOR_PALETTE } from '@shared/catalog'
import { useApp } from '../context'
import { useI18n, type MessageKey } from '../i18n'
import { categoryName, percent } from '../utils'

export function AppIcon({ icon, name, size = 20, color }: { icon: string | null | undefined; name: string; size?: number; color?: string }): ReactNode {
  const style = { width: size, height: size }
  if (icon) return <img className="app-icon" src={icon} alt="" style={style} draggable={false} />
  return (
    <span
      className="app-icon app-icon-fallback"
      style={{ ...style, background: color ?? 'var(--bgColor-neutral-emphasis)', fontSize: Math.round(size * 0.55) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export function LabelToken({ label }: { label: Label }): ReactNode {
  return <IssueLabelToken text={label.name} fillColor={label.color} size="small" />
}

export function TaskLabels({ ids }: { ids: number[] }): ReactNode {
  const { labelById } = useApp()
  const labels = ids.map((id) => labelById.get(id)).filter((l): l is Label => l != null)
  if (!labels.length) return null
  return (
    <span className="task-row-labels">
      {labels.map((l) => (
        <LabelToken key={l.id} label={l} />
      ))}
    </span>
  )
}

export function ProjectBadge({ project }: { project: Project }): ReactNode {
  return (
    <span className="item">
      <span className="project-dot" style={{ background: project.color }} />
      {project.name}
    </span>
  )
}

export function StateIcon({ task, size = 16 }: { task: Pick<Task, 'status'>; size?: number }): ReactNode {
  return task.status === 'open' ? (
    <IssueOpenedIcon size={size} className="fg-success" />
  ) : (
    <IssueClosedIcon size={size} className="fg-done" />
  )
}

const PRIORITY_VARIANT = { 1: 'secondary', 2: 'attention', 3: 'danger' } as const

export function PriorityLabel({ priority }: { priority: Priority }): ReactNode {
  const { t } = useI18n()
  if (!priority) return null
  return (
    <PrimerLabel variant={PRIORITY_VARIANT[priority]} size="small">
      {t(`priority.${priority}` as MessageKey)}
    </PrimerLabel>
  )
}

export function Blankslate({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="blankslate">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function Markdown({ source }: { source: string }): ReactNode {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}

export function ErrorFlash({ error }: { error: string | null | undefined }): ReactNode {
  return error ? (
    <Flash variant="danger" className="mb-3">
      {error}
    </Flash>
  ) : null
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactNode {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {children}
      {hint && <span className="small muted">{hint}</span>}
    </label>
  )
}

export function ColorPicker({ value, onChange }: { value: string; onChange(color: string): void }): ReactNode {
  return (
    <div className="color-swatches">
      {COLOR_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          className={`color-swatch${c.toLowerCase() === value.toLowerCase() ? ' selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  )
}

export function ColorField({ value, onChange }: { value: string; onChange(color: string): void }): ReactNode {
  const { t } = useI18n()
  return (
    <div className="form-field">
      <span className="form-label">{t('labels.color')}</span>
      <div className="row row-wrap">
        <TextInput className="w-110 mono" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('labels.color')} />
        <ColorPicker value={value} onChange={onChange} />
      </div>
    </div>
  )
}

export function Progress({ value, color }: { value: number; color?: string }): ReactNode {
  return (
    <div className="share-bar progress">
      <span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color ?? 'var(--bgColor-success-emphasis)' }} />
    </div>
  )
}

export function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }): ReactNode {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
    </div>
  )
}

/** GitHub's "Languages" bar, used for time per category. */
export function CategoryBar({ items }: { items: UsageItem[] }): ReactNode {
  const { categoryById } = useApp()
  const { t } = useI18n()
  const total = items.reduce((s, i) => s + i.ms, 0)
  if (!total) return <p className="muted small m-0">{t('common.noActivity')}</p>
  return (
    <>
      <div className="lang-bar">
        {items.map((i) => {
          const c = categoryById.get(i.id)
          return <span key={i.id} style={{ width: `${(i.ms / total) * 100}%`, background: c?.color }} title={`${categoryName(c, t)} ${percent(i.ms / total)}`} />
        })}
      </div>
      <ul className="lang-list">
        {items.map((i) => {
          const c = categoryById.get(i.id)
          return (
            <li key={i.id}>
              <span className="color-dot" style={{ background: c?.color }} />
              <span className="name">{categoryName(c, t)}</span>
              <span className="muted">{percent(i.ms / total)}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function AppUsageList({ items, limit = 6 }: { items: UsageItem[]; limit?: number }): ReactNode {
  const { appById, categoryById } = useApp()
  const { duration, t } = useI18n()
  const top = items.slice(0, limit)
  const max = top[0]?.ms ?? 0
  if (!top.length) return <p className="muted small m-0">{t('common.noActivity')}</p>
  return (
    <ul className="app-usage">
      {top.map((i) => {
        const app = appById.get(i.id)
        const color = categoryById.get(app?.categoryId ?? -1)?.color
        return (
          <li key={i.id}>
            <AppIcon icon={app?.icon} name={app?.displayName ?? '?'} color={color} />
            <div className="grow">
              <div className="row">
                <span className="truncate grow">{app?.displayName ?? '?'}</span>
                <span className="muted nowrap small">{duration(i.ms)}</span>
              </div>
              <div className="share-bar progress">
                <span style={{ width: `${(i.ms / max) * 100}%`, background: color }} />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
