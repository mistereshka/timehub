import { useState, type ReactNode } from 'react'
import { Button, Dialog, Label, TextInput } from '@primer/react'
import {
  ArrowLeftIcon, ClockIcon, FileDirectoryIcon, GraphIcon, HistoryIcon, PackageIcon, PencilIcon, PlayIcon, SyncIcon, UploadIcon
} from '@primer/octicons-react'
import { Link, useNavigate } from 'react-router'
import type { MinecraftInstance } from '@shared/types'
import { api } from '../api'
import { useAction, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { Blankslate, ErrorFlash, Field, Stat } from '../components/common'

/** Prism counts all the time an instance runs, timehub only what it saw — the larger one is the time played. */
const playedMs = (i: MinecraftInstance): number => Math.max(i.prismMs, i.trackedMs)
const lastAt = (i: MinecraftInstance): number => Math.max(i.lastLaunch ?? 0, i.lastPlayed ?? 0)

function InstanceIcon({ icon }: { icon: string | null }): ReactNode {
  return icon ? (
    <img className="mc-icon" src={icon} alt="" draggable={false} />
  ) : (
    <span className="mc-icon mc-icon-empty" aria-hidden="true">
      ⛏️
    </span>
  )
}

/** Minecraft from the library: Prism Launcher instances, the time played in each, one click to start. */
export function MinecraftPage(): ReactNode {
  const { t, tn, duration, ago } = useI18n()
  const navigate = useNavigate()
  const data = useQuery(() => api.listMinecraft(), [], ['activity', 'meta'])
  const [launching, setLaunching] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const launch = useAction(async (id: string) => {
    setLaunching(id)
    setTimeout(() => setLaunching((x) => (x === id ? null : x)), 8000)
    await api.launchMinecraft(id)
  })
  const folder = useAction((id: string) => api.openMinecraftFolder(id))

  const overview = data.data
  const instances = overview?.instances ?? []
  const edited = instances.find((i) => i.id === editing)
  const top = Math.max(1, ...instances.map(playedMs))
  const prismTotal = instances.reduce((sum, i) => sum + i.prismMs, 0)
  const trackedTotal = instances.reduce((sum, i) => sum + i.trackedMs, 0) + (overview?.other?.trackedMs ?? 0)
  const last = instances.find((i) => lastAt(i) > 0)

  const details = (i: MinecraftInstance): string =>
    [
      i.customName && i.autoLabel,
      i.mcVersion && `Minecraft ${i.mcVersion}`,
      i.loader ? [i.loader, i.loaderVersion].filter(Boolean).join(' ') : t('mc.vanilla'),
      i.modCount > 0 && tn('mc.mods', i.modCount),
      t('mc.folderName', { name: i.id })
    ]
      .filter(Boolean)
      .join(' · ')
  const times = (i: MinecraftInstance): string =>
    lastAt(i) === 0 && playedMs(i) === 0
      ? t('mc.never')
      : [
          i.prismMs > 0 && t('mc.prismTime', { time: duration(i.prismMs) }),
          i.trackedMs > 0 && t('mc.trackedTime', { time: duration(i.trackedMs) }),
          lastAt(i) > 0 && t('mc.lastLaunch', { ago: ago(lastAt(i)) })
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <div className="container container-wide">
      <div className="mb-2">
        <Link to="/library?kind=game" className="small">
          <ArrowLeftIcon size={14} /> {t('mc.back')}
        </Link>
      </div>
      <div className="mc-hero" style={overview ? { backgroundImage: `url("${overview.art.banner}")` } : undefined}>
        <div className="mc-hero-body">
          {overview && <img className="mc-hero-poster" src={overview.art.poster} alt="" draggable={false} />}
          <div style={{ minWidth: 0 }}>
            <h1 className="mc-hero-title">{t('mc.title')}</h1>
            <div className="mc-hero-sub">{t('mc.subtitle')}</div>
          </div>
        </div>
      </div>
      <ErrorFlash error={launch.error ?? folder.error} />

      {overview && !overview.found ? (
        <div className="box">
          <Blankslate icon={<PackageIcon size={24} />} title={t('mc.emptyTitle')}>
            <p>{t('mc.emptyText')}</p>
          </Blankslate>
        </div>
      ) : (
        overview && (
          <>
            <div className="stat-grid mb-3">
              <Stat icon={<ClockIcon size={14} />} label={t('mc.total')} value={duration(prismTotal)} />
              <Stat icon={<GraphIcon size={14} />} label={t('mc.tracked')} value={duration(trackedTotal)} />
              <Stat icon={<PackageIcon size={14} />} label={t('mc.instances')} value={instances.length} />
              <Stat
                icon={<HistoryIcon size={14} />}
                label={t('mc.lastPlayed')}
                value={
                  last ? (
                    <span className="truncate" style={{ display: 'block' }} title={last.label}>
                      {`${last.label} · ${ago(lastAt(last))}`}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
            </div>

            <section className="box">
              <div className="box-header">
                <h2 className="box-title">{t('mc.instances')}</h2>
                <span className="small muted">{t('mc.hint')}</span>
              </div>
              {instances.length === 0 && <div className="box-body small muted">{t('mc.noInstances')}</div>}
              {instances.map((i) => (
                <div key={i.id} className="box-row mc-row">
                  <button type="button" className="mc-icon-btn" title={t('mc.edit')} onClick={() => setEditing(i.id)}>
                    <InstanceIcon icon={i.icon} />
                  </button>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="bold truncate" title={i.label}>
                        {i.label}
                      </span>
                      {i.running && <Label variant="success">{t('mc.running')}</Label>}
                    </div>
                    <div className="small muted truncate">{details(i)}</div>
                    <div className="small">{times(i)}</div>
                    <div className="share-bar mc-bar">
                      <span style={{ width: `${(playedMs(i) / top) * 100}%` }} />
                    </div>
                  </div>
                  <div className="mc-actions">
                    <Button
                      variant="primary"
                      size="small"
                      leadingVisual={PlayIcon}
                      disabled={!overview.canLaunch || i.running || launching === i.id}
                      onClick={() => void launch.run(i.id)}
                    >
                      {launching === i.id ? t('mc.launching') : t('mc.play')}
                    </Button>
                    <Button size="small" leadingVisual={PencilIcon} onClick={() => setEditing(i.id)}>
                      {t('mc.edit')}
                    </Button>
                    <Button size="small" leadingVisual={FileDirectoryIcon} onClick={() => void folder.run(i.id)}>
                      {t('mc.folder')}
                    </Button>
                    {i.appId != null && (
                      <Button size="small" leadingVisual={GraphIcon} onClick={() => navigate(`/activity/apps/${i.appId}`)}>
                        {t('mc.report')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {overview.other && (
                <div className="box-row mc-row">
                  <InstanceIcon icon={null} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="bold">{t('mc.other')}</div>
                    <div className="small muted truncate">{t('mc.otherHint')}</div>
                    <div className="small">
                      {[
                        t('mc.trackedTime', { time: duration(overview.other.trackedMs) }),
                        overview.other.lastPlayed && t('mc.lastLaunch', { ago: ago(overview.other.lastPlayed) })
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="mc-actions">
                    <Button size="small" leadingVisual={GraphIcon} onClick={() => navigate(`/activity/apps/${overview.other!.appId}`)}>
                      {t('mc.report')}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </>
        )
      )}
      {edited && <InstanceDialog key={edited.id} instance={edited} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Your own name and icon for an instance. */
function InstanceDialog({ instance, onClose }: { instance: MinecraftInstance; onClose(): void }): ReactNode {
  const { t } = useI18n()
  const [name, setName] = useState(instance.customName ? instance.label : '')
  const save = useAction(async () => {
    await api.renameMinecraft(instance.id, name.trim() || null)
    onClose()
  })
  const choices = useQuery(() => api.listMinecraftIcons(), [], ['meta'])
  const pick = useAction(() => api.pickMinecraftIcon(instance.id))
  const choose = useAction((key: string | null) => api.setMinecraftIcon(instance.id, key))
  const shuffle = useAction(() => api.shuffleMinecraftIcon(instance.id))
  const folder = useAction(() => api.openMinecraftIconFolder())
  return (
    <Dialog
      title={t('mc.editTitle', { name: instance.label })}
      onClose={onClose}
      footerButtons={[
        { content: t('common.cancel'), onClick: onClose },
        { content: t('common.save'), buttonType: 'primary', disabled: save.busy, onClick: () => void save.run() }
      ]}
    >
      <div className="stack">
        <ErrorFlash error={save.error ?? pick.error ?? choose.error ?? shuffle.error ?? folder.error ?? choices.error} />
        <Field label={t('mc.field.name')} hint={t('mc.nameHint')}>
          <TextInput
            block
            autoFocus
            value={name}
            placeholder={instance.autoLabel}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save.run()
            }}
          />
        </Field>
        <div className="form-field">
          <span className="form-label">{t('mc.field.icon')}</span>
          <div className="row row-wrap" style={{ gap: 8, alignItems: 'center' }}>
            <InstanceIcon icon={instance.icon} />
            <Button size="small" leadingVisual={SyncIcon} disabled={shuffle.busy} onClick={() => void shuffle.run()}>
              {t('mc.shuffleIcon')}
            </Button>
            <Button size="small" leadingVisual={UploadIcon} disabled={pick.busy} onClick={() => void pick.run()}>
              {t('mc.pickIcon')}
            </Button>
            <Button size="small" leadingVisual={FileDirectoryIcon} onClick={() => void folder.run()}>
              {t('mc.iconFolder')}
            </Button>
            {instance.customIcon && (
              <Button size="small" variant="invisible" disabled={choose.busy} onClick={() => void choose.run(null)}>
                {t('mc.clearIcon')}
              </Button>
            )}
          </div>
          <div className="mc-icon-grid">
            {(choices.data ?? []).map((c) => (
              <button
                key={c.key}
                type="button"
                className={`mc-icon-choice${c.key === instance.iconChoice ? ' selected' : ''}`}
                title={c.own ? c.key.slice('file:'.length) : undefined}
                aria-pressed={c.key === instance.iconChoice}
                onClick={() => void choose.run(c.key)}
              >
                <img src={c.url} alt="" draggable={false} />
              </button>
            ))}
          </div>
          <span className="small muted">{t('mc.iconHint')}</span>
        </div>
      </div>
    </Dialog>
  )
}
