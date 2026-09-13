import { useEffect, useState, type ReactNode } from 'react'
import { Button, Checkbox, Dialog, SegmentedControl, Select, Spinner, TextInput, Textarea, useConfirm } from '@primer/react'
import { CheckIcon, GraphIcon, LinkExternalIcon, SearchIcon } from '@primer/octicons-react'
import { Link, useNavigate } from 'react-router'
import type { LibraryInput, LibraryItem, LibraryKind, LibrarySearchResult, LibraryStatus } from '@shared/types'
import { api, errorMessage } from '../api'
import { useAction } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { libraryStatusLabel, libraryUnit } from '../utils'
import { Cover, ErrorFlash, Field } from './common'

export const LIBRARY_KINDS: LibraryKind[] = ['anime', 'manga', 'book', 'movie', 'series', 'game', 'music']
export const LIBRARY_STATUSES: LibraryStatus[] = ['active', 'planned', 'completed', 'on_hold', 'dropped', 'rewatching']
export const KIND_EMOJI: Record<LibraryKind, string> = {
  anime: '📺', manga: '📖', book: '📚', movie: '🎬', series: '🎞️', game: '🎮', music: '🎵'
}

const SOURCE_NAMES: Record<string, string> = {
  anilib: 'AniLib', mangalib: 'MangaLib', ranobelib: 'RanobeLib', shikimori: 'Shikimori', steam: 'Steam', tracker: 'timehub'
}
export const sourceName = (source: string, t: (k: MessageKey) => string): string => SOURCE_NAMES[source] ?? t('lib.source.manual')

export function LibraryItemDialog({ item, kind, onClose }: { item: LibraryItem | null; kind?: LibraryKind; onClose(): void }): ReactNode {
  const { t, duration } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [form, setForm] = useState<LibraryInput>(() =>
    item
      ? {
          id: item.id, kind: item.kind, title: item.title, originalTitle: item.originalTitle, coverUrl: item.coverUrl, status: item.status,
          favorite: item.favorite, progress: item.progress, total: item.total, rating: item.rating, notes: item.notes, year: item.year,
          format: item.format, url: item.url, statusAuto: item.statusAuto
        }
      : { kind: kind ?? 'anime', title: '', status: 'planned', progress: 0, total: null, favorite: false, rating: null }
  )
  const set = <K extends keyof LibraryInput>(key: K, v: LibraryInput[K]): void => setForm((f) => ({ ...f, [key]: v }))
  const save = useAction(async () => {
    await api.saveLibraryItem(form)
    onClose()
  })
  const remove = useAction(async () => {
    if (!item) return
    const ok = await confirm({ title: t('lib.deleteTitle'), content: t('lib.deleteConfirm'), confirmButtonType: 'danger', confirmButtonContent: t('common.delete') })
    if (!ok) return
    await api.deleteLibraryItem(item.id)
    onClose()
  })
  const unit = libraryUnit(form.kind, t, item?.source)
  const num = (v: string): number | null => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v)) || 0))

  return (
    <Dialog
      title={item ? t('lib.edit') : t('lib.newItem')}
      width="xlarge"
      onClose={onClose}
      footerButtons={[
        ...(item ? [{ content: t('common.delete'), buttonType: 'danger' as const, onClick: () => void remove.run() }] : []),
        { content: t('common.cancel'), onClick: onClose },
        { content: t('common.save'), buttonType: 'primary', disabled: !form.title.trim() || save.busy, onClick: () => void save.run() }
      ]}
    >
      <div className="stack">
        <ErrorFlash error={save.error ?? remove.error} />
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <Cover src={form.coverUrl} title={form.title || '?'} width={110} height={156} />
          <div className="grow stack stack-sm">
            <Field label={t('lib.field.title')}>
              <TextInput block autoFocus={!item} value={form.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label={t('lib.field.original')}>
              <TextInput block value={form.originalTitle ?? ''} onChange={(e) => set('originalTitle', e.target.value)} />
            </Field>
            {item && (
              <div className="row row-wrap small">
                {item.url && (
                  <Button size="small" leadingVisual={LinkExternalIcon} onClick={() => void api.openExternal(item.url!)}>
                    {t('lib.openLink')}
                  </Button>
                )}
                {item.appId != null && (
                  <Button
                    size="small"
                    leadingVisual={GraphIcon}
                    onClick={() => {
                      onClose()
                      navigate(`/activity/apps/${item.appId}`)
                    }}
                  >
                    {t('lib.openReport')}
                  </Button>
                )}
                {item.kind === 'game' && item.trackedMs > 0 && <span className="muted">{t('lib.playedTime', { time: duration(item.trackedMs) })}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="form-grid three">
          <Field label={t('lib.field.kind')}>
            <Select block value={form.kind} onChange={(e) => set('kind', e.target.value as LibraryKind)}>
              {LIBRARY_KINDS.map((k) => (
                <Select.Option key={k} value={k}>{`${KIND_EMOJI[k]} ${t(`lib.kind.${k}` as MessageKey)}`}</Select.Option>
              ))}
            </Select>
          </Field>
          <Field label={t('lib.field.status')}>
            <Select block value={form.status ?? 'planned'} onChange={(e) => set('status', e.target.value as LibraryStatus)}>
              {LIBRARY_STATUSES.map((s) => (
                <Select.Option key={s} value={s}>
                  {libraryStatusLabel(s, form.kind, t)}
                </Select.Option>
              ))}
            </Select>
          </Field>
          <Field label={t('lib.field.rating')}>
            <Select block value={form.rating == null ? '' : String(form.rating)} onChange={(e) => set('rating', e.target.value ? Number(e.target.value) : null)}>
              <Select.Option value="">—</Select.Option>
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((r) => (
                <Select.Option key={r} value={String(r)}>{`★ ${r}`}</Select.Option>
              ))}
            </Select>
          </Field>
          <Field label={t('lib.field.progress', { unit })}>
            <div className="row">
              <Button size="small" onClick={() => set('progress', Math.max(0, (form.progress ?? 0) - 1))}>
                −
              </Button>
              <TextInput className="w-80" type="number" min={0} value={form.progress ?? 0} onChange={(e) => set('progress', num(e.target.value) ?? 0)} />
              <Button size="small" onClick={() => set('progress', (form.progress ?? 0) + 1)}>
                +1
              </Button>
            </div>
          </Field>
          <Field label={t('lib.field.total', { unit })}>
            <TextInput block type="number" min={0} value={form.total ?? ''} onChange={(e) => set('total', num(e.target.value))} />
          </Field>
          <Field label={t('lib.field.year')}>
            <TextInput block type="number" value={form.year ?? ''} onChange={(e) => set('year', num(e.target.value))} />
          </Field>
        </div>
        <div className="row row-wrap">
          <label className="check-field">
            <Checkbox checked={!!form.favorite} onChange={(e) => set('favorite', e.target.checked)} />
            <span>{t('lib.field.favorite')}</span>
          </label>
          {item && item.source !== 'manual' && (
            <label className="check-field">
              <Checkbox checked={!!form.statusAuto} onChange={(e) => set('statusAuto', e.target.checked)} />
              <span>{t('lib.field.auto', { source: sourceName(item.source, t) })}</span>
            </label>
          )}
        </div>
        <div className="form-grid">
          <Field label={t('lib.field.cover')}>
            <TextInput block value={form.coverUrl ?? ''} placeholder="https://…" onChange={(e) => set('coverUrl', e.target.value || null)} />
          </Field>
          <Field label={t('lib.field.url')}>
            <TextInput block value={form.url ?? ''} placeholder="https://…" onChange={(e) => set('url', e.target.value || null)} />
          </Field>
        </div>
        <Field label={t('lib.field.notes')}>
          <Textarea block rows={3} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}

/** Search AniLib / Open Library / Steam / TMDB and add titles in one click. */
export function LibraryAddDialog({
  initialKind,
  onClose,
  onManual
}: {
  initialKind: LibraryKind
  onClose(): void
  onManual(kind: LibraryKind): void
}): ReactNode {
  const { t } = useI18n()
  const [kind, setKind] = useState<LibraryKind>(initialKind)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibrarySearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      api.searchLibrary(kind, q).then(
        (r) => {
          if (cancelled) return
          setResults(r)
          setError(null)
          setLoading(false)
        },
        (err: unknown) => {
          if (cancelled) return
          setError(errorMessage(err))
          setLoading(false)
        }
      )
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [kind, query])

  const add = async (r: LibrarySearchResult): Promise<void> => {
    await api.saveLibraryItem({
      kind: r.kind, title: r.title, originalTitle: r.originalTitle, coverUrl: r.coverUrl, total: r.total, year: r.year, format: r.format,
      url: r.url, status: 'planned'
    })
    setAdded((s) => new Set(s).add(r.url ?? r.title))
  }

  return (
    <Dialog
      title={t('lib.addTitle')}
      width="xlarge"
      height="large"
      onClose={onClose}
      footerButtons={[
        { content: t('lib.addManual'), onClick: () => onManual(kind) },
        { content: t('common.close'), buttonType: 'primary', onClick: onClose }
      ]}
    >
      <div className="stack stack-sm">
        <SegmentedControl aria-label={t('lib.field.kind')} size="small" onChange={(i) => setKind(LIBRARY_KINDS[i])}>
          {LIBRARY_KINDS.map((k) => (
            <SegmentedControl.Button key={k} selected={kind === k}>
              {`${KIND_EMOJI[k]} ${t(`lib.kind.${k}` as MessageKey)}`}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
        <TextInput
          block
          autoFocus
          leadingVisual={SearchIcon}
          trailingVisual={loading ? <Spinner size="small" /> : undefined}
          value={query}
          placeholder={t('lib.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ErrorFlash error={error} />
        {(kind === 'movie' || kind === 'series') && results.length === 0 && (
          <p className="small muted m-0">
            {t('lib.tmdbHint')} <Link to="/connections" onClick={onClose}>{t('nav.connections')}</Link>
          </p>
        )}
        {query.trim().length >= 2 && !loading && results.length === 0 && !error && <p className="small muted m-0">{t('lib.noResults')}</p>}
        <div className="search-results">
          {results.map((r) => {
            const key = r.url ?? r.title
            const done = added.has(key)
            return (
              <div key={key} className="box-row" style={{ alignItems: 'center' }}>
                <Cover src={r.coverUrl} title={r.title} width={46} height={64} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="bold truncate">{r.title}</div>
                  {r.originalTitle && <div className="small muted truncate">{r.originalTitle}</div>}
                  <div className="small muted">{[r.format, r.year, r.total ? `${r.total} ${libraryUnit(r.kind, t)}` : null].filter(Boolean).join(' · ')}</div>
                </div>
                <Button size="small" variant={done ? 'invisible' : 'primary'} leadingVisual={done ? CheckIcon : undefined} disabled={done} onClick={() => void add(r)}>
                  {done ? t('lib.added') : t('lib.addButton')}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
