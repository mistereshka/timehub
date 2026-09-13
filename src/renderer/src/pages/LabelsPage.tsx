import { useState, type ReactNode } from 'react'
import { Button, Label as PrimerLabel, SegmentedControl, TextInput, useConfirm } from '@primer/react'
import { RepoIcon, TagIcon } from '@primer/octicons-react'
import { Link, useSearchParams } from 'react-router'
import type { Label, Project } from '@shared/types'
import { COLOR_PALETTE } from '@shared/catalog'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { ColorField, ErrorFlash, Field, LabelToken } from '../components/common'

const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s)
const randomColor = (): string => COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]

/** Labels and projects management, like GitHub's labels page. */
export function LabelsPage(): ReactNode {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'projects' ? 'projects' : 'labels'
  const { t } = useI18n()
  return (
    <div className="container container-narrow">
      <div className="page-head">
        <SegmentedControl aria-label={t('labels.tabs')} onChange={(i) => setParams(i === 1 ? { tab: 'projects' } : {})}>
          <SegmentedControl.Button selected={tab === 'labels'} leadingVisual={TagIcon}>
            {t('labels.labels')}
          </SegmentedControl.Button>
          <SegmentedControl.Button selected={tab === 'projects'} leadingVisual={RepoIcon}>
            {t('labels.projects')}
          </SegmentedControl.Button>
        </SegmentedControl>
      </div>
      {tab === 'labels' ? <LabelsList /> : <ProjectsList />}
    </div>
  )
}

function LabelsList(): ReactNode {
  const { labels } = useApp()
  const { t, tn } = useI18n()
  const confirm = useConfirm()
  const tasks = useQuery(() => api.listTasks({ status: 'open' }), [], ['tasks'])
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const count = (id: number): number => (tasks.data ?? []).filter((x) => x.labelIds.includes(id)).length
  const remove = async (l: Label): Promise<void> => {
    const ok = await confirm({
      title: t('labels.deleteTitle'),
      content: t('labels.deleteConfirm', { name: l.name }),
      confirmButtonType: 'danger',
      confirmButtonContent: t('common.delete')
    })
    if (ok) await api.deleteLabel(l.id)
  }

  return (
    <>
      <div className="row mb-3">
        <span className="grow muted">{t('labels.labelsHint')}</span>
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('labels.newLabel')}
        </Button>
      </div>
      {editing === 'new' && (
        <div className="box mb-3">
          <div className="box-body">
            <LabelEditor onDone={() => setEditing(null)} />
          </div>
        </div>
      )}
      <div className="box">
        <div className="box-header">
          <h2 className="box-title">{tn('labels.count', labels.length)}</h2>
        </div>
        {labels.map((l) =>
          editing === l.id ? (
            <div key={l.id} className="box-row">
              <LabelEditor label={l} onDone={() => setEditing(null)} />
            </div>
          ) : (
            <div key={l.id} className="box-row hoverable" style={{ alignItems: 'center' }}>
              <div className="label-cell">
                <LabelToken label={l} />
              </div>
              <span className="grow small muted truncate">{l.description}</span>
              <Link className="small muted nowrap link-plain" to={`/tasks?q=${encodeURIComponent(`is:open label:${quote(l.name)} `)}`}>
                {tn('labels.openTasks', count(l.id))}
              </Link>
              <Button size="small" variant="invisible" onClick={() => setEditing(l.id)}>
                {t('common.edit')}
              </Button>
              <Button size="small" variant="invisible" onClick={() => void remove(l)}>
                {t('common.delete')}
              </Button>
            </div>
          )
        )}
      </div>
    </>
  )
}

function LabelEditor({ label, onDone }: { label?: Label; onDone(): void }): ReactNode {
  const { t } = useI18n()
  const [name, setName] = useState(label?.name ?? '')
  const [description, setDescription] = useState(label?.description ?? '')
  const [color, setColor] = useState(label?.color ?? randomColor)
  const save = useAction(async () => {
    await api.saveLabel({ id: label?.id, name, description, color })
    onDone()
  })
  return (
    <form
      className="stack stack-sm grow"
      onSubmit={(e) => {
        e.preventDefault()
        void save.run()
      }}
    >
      <div>
        <LabelToken label={{ id: 0, name: name.trim() || t('labels.preview'), color, description }} />
      </div>
      <ErrorFlash error={save.error} />
      <div className="form-grid">
        <Field label={t('labels.name')}>
          <TextInput block autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('labels.description')}>
          <TextInput block value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <ColorField value={color} onChange={setColor} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={!name.trim() || save.busy}>
          {label ? t('common.save') : t('labels.create')}
        </Button>
      </div>
    </form>
  )
}

function ProjectsList(): ReactNode {
  const { projects } = useApp()
  const { t, tn } = useI18n()
  const confirm = useConfirm()
  const tasks = useQuery(() => api.listTasks({ status: 'open' }), [], ['tasks'])
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const count = (id: number): number => (tasks.data ?? []).filter((x) => x.projectId === id).length
  const remove = async (p: Project): Promise<void> => {
    const ok = await confirm({
      title: t('labels.deleteProjectTitle'),
      content: t('labels.deleteProjectConfirm', { name: p.name }),
      confirmButtonType: 'danger',
      confirmButtonContent: t('common.delete')
    })
    if (ok) await api.deleteProject(p.id)
  }

  return (
    <>
      <div className="row mb-3">
        <span className="grow muted">{t('labels.projectsHint')}</span>
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('labels.newProject')}
        </Button>
      </div>
      {editing === 'new' && (
        <div className="box mb-3">
          <div className="box-body">
            <ProjectEditor onDone={() => setEditing(null)} />
          </div>
        </div>
      )}
      <div className="box">
        <div className="box-header">
          <h2 className="box-title">{tn('labels.projectCount', projects.length)}</h2>
        </div>
        {projects.length === 0 && <div className="box-body small muted">{t('labels.noProjects')}</div>}
        {projects.map((p) =>
          editing === p.id ? (
            <div key={p.id} className="box-row">
              <ProjectEditor project={p} onDone={() => setEditing(null)} />
            </div>
          ) : (
            <div key={p.id} className="box-row hoverable" style={{ alignItems: 'center' }}>
              <span className="project-dot" style={{ background: p.color }} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row">
                  <span className={`bold${p.archived ? ' muted' : ''}`}>{p.name}</span>
                  {p.archived && <PrimerLabel size="small">{t('labels.archived')}</PrimerLabel>}
                </div>
                {p.description && <div className="small muted truncate">{p.description}</div>}
              </div>
              <Link className="small muted nowrap link-plain" to={`/tasks?q=${encodeURIComponent(`is:open project:${quote(p.name)} `)}`}>
                {tn('labels.openTasks', count(p.id))}
              </Link>
              <Button size="small" variant="invisible" onClick={() => setEditing(p.id)}>
                {t('common.edit')}
              </Button>
              <Button size="small" variant="invisible" onClick={() => void api.saveProject({ ...p, archived: !p.archived })}>
                {p.archived ? t('labels.unarchive') : t('labels.archive')}
              </Button>
              <Button size="small" variant="invisible" onClick={() => void remove(p)}>
                {t('common.delete')}
              </Button>
            </div>
          )
        )}
      </div>
    </>
  )
}

function ProjectEditor({ project, onDone }: { project?: Project; onDone(): void }): ReactNode {
  const { t } = useI18n()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [color, setColor] = useState(project?.color ?? randomColor)
  const save = useAction(async () => {
    await api.saveProject({ id: project?.id, name, description, color, archived: project?.archived ?? false })
    onDone()
  })
  return (
    <form
      className="stack stack-sm grow"
      onSubmit={(e) => {
        e.preventDefault()
        void save.run()
      }}
    >
      <ErrorFlash error={save.error} />
      <div className="form-grid">
        <Field label={t('labels.name')}>
          <TextInput block autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('labels.description')}>
          <TextInput block value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <ColorField value={color} onChange={setColor} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={!name.trim() || save.busy}>
          {project ? t('common.save') : t('labels.create')}
        </Button>
      </div>
    </form>
  )
}
