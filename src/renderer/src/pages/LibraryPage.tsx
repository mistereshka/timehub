import { useState, type ReactNode } from 'react'
import { ActionList, ActionMenu, Button, IconButton, LinkButton, TextInput } from '@primer/react'
import {
  AppsIcon, HeartFillIcon, HeartIcon, ListUnorderedIcon, PlugIcon, PlusIcon, SearchIcon, SyncIcon, TriangleDownIcon
} from '@primer/octicons-react'
import { useSearchParams } from 'react-router'
import type { LibraryItem, LibraryKind, LibraryStatus } from '@shared/types'
import { api } from '../api'
import { useAction, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { libraryStatusLabel, libraryUnit } from '../utils'
import { Blankslate, Cover, ErrorFlash, MiniProgress } from '../components/common'
import { KIND_EMOJI, LIBRARY_KINDS, LIBRARY_STATUSES, LibraryAddDialog, LibraryItemDialog, sourceName } from '../components/LibraryDialogs'

type SortKey = 'updated' | 'name' | 'rating' | 'progress'
const SORTS: SortKey[] = ['updated', 'name', 'rating', 'progress']
const VIEW_KEY = 'timehub.library.view'

const ratio = (i: LibraryItem): number => (i.total ? i.progress / i.total : i.progress > 0 ? 0.5 : 0)
/** New episodes/chapters since you last caught up — only for things you've started. */
const freshCount = (i: LibraryItem): number =>
  i.latest != null && i.progress > 0 && i.latest > i.progress && ['active', 'rewatching', 'on_hold'].includes(i.status)
    ? i.latest - i.progress
    : 0

function sortItems(list: LibraryItem[], sort: SortKey, dir: 'asc' | 'desc'): LibraryItem[] {
  const m = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    switch (sort) {
      case 'name':
        return m * a.title.localeCompare(b.title)
      case 'rating':
        return m * ((a.rating ?? -1) - (b.rating ?? -1))
      case 'progress':
        return m * (ratio(a) - ratio(b))
      default:
        return m * (a.updatedAt - b.updatedAt)
    }
  })
}

function readView(): 'list' | 'grid' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

/** Anime, manga, books, movies, series and games — with statuses, progress and sync. */
export function LibraryPage(): ReactNode {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') as LibraryKind | null) ?? null
  const status = params.get('status') ?? 'all'
  const [view, setViewState] = useState<'list' | 'grid'>(readView)
  const [sort, setSort] = useState<SortKey>('updated')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<LibraryItem | { newKind: LibraryKind } | null>(null)
  const [adding, setAdding] = useState(false)
  const items = useQuery(() => api.listLibrary(), [], ['library', 'activity'])
  const conns = useQuery(() => api.listConnections(), [], ['connections'])

  const setView = (v: 'list' | 'grid'): void => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // not persisted
    }
  }
  const setParam = (key: string, value: string | null): void =>
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (value) p.set(key, value)
      else p.delete(key)
      return p
    })

  const all = items.data ?? []
  const ofKind = kind ? all.filter((i) => i.kind === kind) : all
  const countStatus = (s: string): number => ofKind.filter((i) => (s === 'favorite' ? i.favorite : i.status === s)).length
  const needle = filter.trim().toLowerCase()
  const shown = sortItems(
    ofKind.filter(
      (i) =>
        (status === 'all' || (status === 'favorite' ? i.favorite : i.status === status)) &&
        (!needle || i.title.toLowerCase().includes(needle) || i.originalTitle.toLowerCase().includes(needle))
    ),
    sort,
    dir
  )
  const syncable = (conns.data ?? []).filter((c) => ['anilib', 'shikimori', 'steam', 'media'].includes(c.key) && c.enabled && c.connected)
  const sync = useAction(async () => {
    for (const c of syncable) await api.syncConnection(c.key)
  })

  return (
    <div className="container container-wide">
      <div className="library-layout">
        <aside className="library-side">
          <SideGroup title={t('lib.lists')}>
            <SideItem active={status === 'all'} label={t('lib.status.all')} count={ofKind.length} onClick={() => setParam('status', null)} />
            {LIBRARY_STATUSES.map((s) => (
              <SideItem key={s} active={status === s} label={libraryStatusLabel(s, kind, t)} count={countStatus(s)} onClick={() => setParam('status', s)} />
            ))}
            <SideItem
              active={status === 'favorite'}
              label={t('lib.favorite')}
              count={countStatus('favorite')}
              icon={<HeartIcon size={14} />}
              onClick={() => setParam('status', 'favorite')}
            />
          </SideGroup>
          <SideGroup title={t('lib.type')}>
            <SideItem active={!kind} label={t('lib.kind.all')} count={all.length} onClick={() => setParam('kind', null)} />
            {LIBRARY_KINDS.map((k) => (
              <SideItem
                key={k}
                active={kind === k}
                label={`${KIND_EMOJI[k]} ${t(`lib.kind.${k}` as MessageKey)}`}
                count={all.filter((i) => i.kind === k).length}
                onClick={() => setParam('kind', k)}
              />
            ))}
          </SideGroup>
          <SideGroup title={t('lib.view')}>
            <SideItem active={view === 'list'} label={t('lib.view.list')} icon={<ListUnorderedIcon size={14} />} onClick={() => setView('list')} />
            <SideItem active={view === 'grid'} label={t('lib.view.grid')} icon={<AppsIcon size={14} />} onClick={() => setView('grid')} />
          </SideGroup>
          <SideGroup title={t('lib.sort')}>
            {SORTS.map((s) => (
              <SideItem
                key={s}
                active={sort === s}
                radio
                label={t(`lib.sort.${s}` as MessageKey)}
                onClick={() => {
                  setSort(s)
                  setDir(s === 'name' ? 'asc' : 'desc')
                }}
              />
            ))}
            <div className="side-divider" />
            <SideItem active={dir === 'desc'} radio label={t('lib.sort.desc')} onClick={() => setDir('desc')} />
            <SideItem active={dir === 'asc'} radio label={t('lib.sort.asc')} onClick={() => setDir('asc')} />
          </SideGroup>
        </aside>

        <div className="library-main">
          <div className="row mb-3">
            <div className="grow">
              <TextInput block leadingVisual={SearchIcon} placeholder={t('lib.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {syncable.length > 0 ? (
              <Button leadingVisual={SyncIcon} disabled={sync.busy} onClick={() => void sync.run()}>
                {t('lib.sync')}
              </Button>
            ) : (
              <LinkButton href="#/connections" leadingVisual={PlugIcon}>
                {t('lib.connect')}
              </LinkButton>
            )}
            <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setAdding(true)}>
              {t('lib.add')}
            </Button>
          </div>
          <ErrorFlash error={sync.error} />
          {shown.length === 0 ? (
            !items.loading && (
              <div className="box">
                <Blankslate icon={<span className="blank-emoji">{kind ? KIND_EMOJI[kind] : '📚'}</span>} title={t('lib.emptyTitle')}>
                  <p>{t('lib.emptyText')}</p>
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    {t('lib.add')}
                  </Button>
                </Blankslate>
              </div>
            )
          ) : view === 'list' ? (
            <div className="box">
              {shown.map((i) => (
                <LibraryRow key={i.id} item={i} onOpen={() => setEditing(i)} />
              ))}
            </div>
          ) : (
            <div className="library-grid">
              {shown.map((i) => (
                <LibraryTile key={i.id} item={i} onOpen={() => setEditing(i)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {adding && (
        <LibraryAddDialog
          initialKind={kind ?? 'anime'}
          onClose={() => setAdding(false)}
          onManual={(k) => {
            setAdding(false)
            setEditing({ newKind: k })
          }}
        />
      )}
      {editing && (
        <LibraryItemDialog
          item={'newKind' in editing ? null : editing}
          kind={'newKind' in editing ? editing.newKind : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function SideGroup({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="side-group">
      <div className="side-title">{title}</div>
      {children}
    </div>
  )
}

function SideItem({
  label,
  count,
  active,
  onClick,
  icon,
  radio
}: {
  label: string
  count?: number
  active: boolean
  onClick(): void
  icon?: ReactNode
  radio?: boolean
}): ReactNode {
  return (
    <button type="button" className={`side-item${active ? ' active' : ''}`} onClick={onClick} aria-pressed={active}>
      {radio && <span className={`side-radio${active ? ' on' : ''}`} />}
      {icon}
      <span className="grow truncate">{label}</span>
      {count != null && <span className="side-count">{count}</span>}
    </button>
  )
}

function ProgressText({ item }: { item: LibraryItem }): ReactNode {
  const { t, duration } = useI18n()
  if (item.kind === 'game') return item.trackedMs > 0 ? <span>{t('lib.playedTime', { time: duration(item.trackedMs) })}</span> : null
  const unit = libraryUnit(item.kind, t, item.source)
  return <span>{item.total ? t('lib.progress', { n: item.progress, total: item.total, unit }) : t('lib.progressOpen', { n: item.progress, unit })}</span>
}

/** The status label doubles as a menu: one click to switch "Смотрю" → "Просмотрено". */
function StatusMenu({ item }: { item: LibraryItem }): ReactNode {
  const { t } = useI18n()
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <button type="button" className={`status-button lib-status lib-status-${item.status}`} title={t('lib.changeStatus')}>
          {libraryStatusLabel(item.status, item.kind, t)}
          <TriangleDownIcon size={12} />
        </button>
      </ActionMenu.Anchor>
      <ActionMenu.Overlay width="small">
        <ActionList selectionVariant="single" aria-label={t('lib.changeStatus')}>
          {LIBRARY_STATUSES.map((s) => (
            <ActionList.Item
              key={s}
              selected={s === item.status}
              onSelect={() => void api.saveLibraryItem({ id: item.id, kind: item.kind, title: item.title, status: s })}
            >
              {libraryStatusLabel(s, item.kind, t)}
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

function LibraryRow({ item, onOpen }: { item: LibraryItem; onOpen(): void }): ReactNode {
  const { t, tn, ago } = useI18n()
  const fresh = freshCount(item)
  const unit = libraryUnit(item.kind, t, item.source)
  return (
    <div className="box-row hoverable lib-row">
      <button type="button" className="lib-cover-btn" onClick={onOpen}>
        <Cover src={item.coverUrl} title={item.title} width={58} height={82} />
        {fresh > 0 && <span className="lib-fresh">{fresh}</span>}
      </button>
      <div className="grow" style={{ minWidth: 0 }}>
        <button type="button" className="lib-title" onClick={onOpen}>
          {item.title}
        </button>
        {item.originalTitle && item.originalTitle !== item.title && <div className="small muted truncate">{item.originalTitle}</div>}
        <div className="task-row-meta">
          <StatusMenu item={item} />
          <ProgressText item={item} />
          {fresh > 0 && <span className="fg-success">{tn('lib.new', fresh)}</span>}
          {(item.format || item.year) && <span>{[item.format, item.year].filter(Boolean).join(' · ')}</span>}
          <span>{sourceName(item.source, t)}</span>
        </div>
        {item.total ? (
          <div className="lib-progress">
            <MiniProgress value={item.progress / item.total} />
          </div>
        ) : null}
      </div>
      <div className="lib-side">
        {item.rating != null && <span className="lib-rating">★ {item.rating}</span>}
        <IconButton
          icon={item.favorite ? HeartFillIcon : HeartIcon}
          size="small"
          variant="invisible"
          className={item.favorite ? 'fg-danger' : undefined}
          aria-label={t('lib.field.favorite')}
          onClick={() => void api.saveLibraryItem({ id: item.id, kind: item.kind, title: item.title, favorite: !item.favorite })}
        />
        {item.kind !== 'game' && item.status !== 'completed' && (
          <Button size="small" onClick={() => void api.bumpLibraryProgress(item.id, 1)} aria-label={t('lib.plusOne')}>
            {`+1 ${unit}`}
          </Button>
        )}
        <span className="small muted nowrap">{ago(item.updatedAt)}</span>
      </div>
    </div>
  )
}

function LibraryTile({ item, onOpen }: { item: LibraryItem; onOpen(): void }): ReactNode {
  const { t } = useI18n()
  const fresh = freshCount(item)
  return (
    <button type="button" className="lib-tile" onClick={onOpen}>
      <span className="lib-tile-cover">
        <Cover src={item.coverUrl} title={item.title} width="100%" height="100%" />
        {fresh > 0 && <span className="lib-fresh">{fresh}</span>}
        {item.favorite && (
          <span className="lib-fav">
            <HeartFillIcon size={12} />
          </span>
        )}
        {item.rating != null && <span className="lib-tile-rating">★ {item.rating}</span>}
      </span>
      <span className="lib-tile-title">{item.title}</span>
      <span className="small muted">
        {libraryStatusLabel(item.status as LibraryStatus, item.kind, t)} · <ProgressText item={item} />
      </span>
      {item.total ? <MiniProgress value={item.progress / item.total} /> : null}
    </button>
  )
}
