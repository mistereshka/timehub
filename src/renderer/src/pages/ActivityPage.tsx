import { useMemo, useState, type ReactNode } from 'react'
import { Button, Checkbox, IconButton, SegmentedControl, Select, TextInput, useConfirm } from '@primer/react'
import {
  ArrowRightIcon, CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, DeviceDesktopIcon, PlusIcon, PulseIcon, StopwatchIcon,
  TagIcon, TrashIcon, UnmuteIcon, ZapIcon
} from '@primer/octicons-react'
import { Link } from 'react-router'
import type { AppInfo, AppPatch, Category, Rule, Task } from '@shared/types'
import { COLOR_PALETTE } from '@shared/catalog'
import { addDays, dayKey, endOfDayMs, parseDayKey, startOfDayMs, startOfWeek, todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { categoryName, dayLabel } from '../utils'
import { AppIcon, Blankslate, CategoryBar, ColorField, ErrorFlash, Field, Stat, StreakBadge } from '../components/common'
import { Bars } from '../components/Bars'
import { DayBars } from '../components/DayBars'
import { RuleDialog } from '../components/RuleDialog'

type Period = 'day' | 'week' | 'month' | 'year' | 'all'
const PERIODS: Period[] = ['day', 'week', 'month', 'year', 'all']
const EPOCH = '2000-01-01'

function periodRange(period: Period, anchor: string, weekStartsOn: 0 | 1, today: string): { from: string; to: string } {
  const d = parseDayKey(anchor)
  switch (period) {
    case 'day':
      return { from: anchor, to: anchor }
    case 'week': {
      const from = startOfWeek(anchor, weekStartsOn)
      return { from, to: addDays(from, 6) }
    }
    case 'month':
      return { from: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), to: dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
    case 'year':
      return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` }
    case 'all':
      return { from: EPOCH, to: today }
  }
}

function shiftAnchor(period: Period, anchor: string, dir: 1 | -1): string {
  const d = parseDayKey(anchor)
  if (period === 'day') return addDays(anchor, dir)
  if (period === 'week') return addDays(anchor, 7 * dir)
  if (period === 'month') return dayKey(new Date(d.getFullYear(), d.getMonth() + dir, 1))
  return dayKey(new Date(d.getFullYear() + dir, 0, 1))
}

export function ActivityPage(): ReactNode {
  const { settings, apps, categoryById } = useApp()
  const i18n = useI18n()
  const { t, tn, date, duration } = i18n
  const today = todayKey()
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(today)
  const range = useMemo(() => periodRange(period, anchor, settings.weekStartsOn, today), [period, anchor, settings.weekStartsOn, today])
  const from = startOfDayMs(range.from)
  const to = endOfDayMs(range.to)
  const byMonth = period === 'year' || period === 'all'
  const usage = useQuery(() => api.getUsage(from, to), [from, to], ['activity', 'meta', 'time'])
  const daily = useQuery(() => api.getDailyActive(range.from, range.to), [range.from, range.to], ['activity'])
  const monthly = useQuery(() => (byMonth ? api.getMonthlyActive(range.from, range.to) : Promise.resolve([])), [byMonth, range.from, range.to], ['activity'])
  const music = useQuery(() => api.getMusic(from, to), [from, to], ['music'])
  const spotify = useQuery(() => api.getSpotifyOverview(), [], ['connections'])
  const streaks = useQuery(() => api.getAppStreaks(), [], ['activity'])
  const rules = useQuery(() => api.listRules(), [], ['meta'])
  const tasks = useQuery(() => api.listTasks(), [], ['tasks'])
  const [ruleOpen, setRuleOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const u = usage.data
  const days = daily.data ?? []
  const activeDays = days.filter((d) => d.value > 0).length
  const usageByApp = new Map((u?.byApp ?? []).map((i) => [i.id, i.ms]))
  const streakByApp = new Map((streaks.data ?? []).map((s) => [s.appId, s.streak]))
  const sortedApps = [...apps].sort(
    (a, b) => (usageByApp.get(b.id) ?? 0) - (usageByApp.get(a.id) ?? 0) || a.displayName.localeCompare(b.displayName)
  )
  const months = monthly.data ?? []
  const firstMonth = months.findIndex((m) => m.value > 0)
  const shownMonths = period === 'all' && firstMonth >= 0 ? months.slice(firstMonth) : months
  const topCategory = u?.byCategory[0]
  const periodTitle =
    period === 'day'
      ? dayLabel(range.from, i18n, 'EEEE, d MMMM yyyy')
      : period === 'week'
        ? `${date(range.from, 'd MMM')} – ${date(range.to, 'd MMM yyyy')}`
        : period === 'month'
          ? date(range.from, 'LLLL yyyy')
          : period === 'year'
            ? range.from.slice(0, 4)
            : t('activity.all')
  const m = music.data

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title grow">{t('activity.title')}</h1>
        <SegmentedControl aria-label={t('activity.period')} onChange={(i) => setPeriod(PERIODS[i])}>
          {PERIODS.map((p) => (
            <SegmentedControl.Button key={p} selected={period === p}>
              {t(`activity.${p}` as MessageKey)}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
        {period !== 'all' && (
          <>
            <IconButton icon={ChevronLeftIcon} aria-label={t('activity.prev')} onClick={() => setAnchor(shiftAnchor(period, anchor, -1))} />
            <span className="bold nowrap period-title cap">{periodTitle}</span>
            <IconButton
              icon={ChevronRightIcon}
              aria-label={t('activity.next')}
              disabled={range.to >= today}
              onClick={() => setAnchor(shiftAnchor(period, anchor, 1))}
            />
          </>
        )}
      </div>

      <div className="stat-grid mb-3">
        <Stat icon={<PulseIcon size={14} />} label={t('activity.total')} value={duration(u?.activeMs ?? 0)} />
        <Stat icon={<CalendarIcon size={14} />} label={t('activity.avg')} value={duration(activeDays ? (u?.activeMs ?? 0) / activeDays : 0)} />
        <Stat icon={<StopwatchIcon size={14} />} label={t('activity.taskTime')} value={duration(u?.taskMs ?? 0)} />
        <Stat icon={<TagIcon size={14} />} label={t('activity.topCategory')} value={topCategory ? categoryName(categoryById.get(topCategory.id), t) : '—'} />
      </div>

      {period !== 'day' && (
        <section className="box mb-3">
          <div className="box-header">
            <h2 className="box-title">{byMonth ? t('activity.byMonth') : t('activity.perDay')}</h2>
          </div>
          <div className="box-body">
            {byMonth ? (
              <Bars
                items={shownMonths.map((mv) => {
                  const [y, mo] = mv.month.split('-').map(Number)
                  return {
                    key: mv.month,
                    label: period === 'all' && shownMonths.length > 14 ? (mo === 1 ? String(y) : '') : date(new Date(y, mo - 1, 1), 'LLL'),
                    value: mv.value,
                    title: `${date(new Date(y, mo - 1, 1), 'LLLL yyyy')}: ${duration(mv.value)}`
                  }
                })}
                format={(v) => duration(v)}
              />
            ) : (
              <DayBars days={days} />
            )}
          </div>
        </section>
      )}

      <section className="box mb-3">
        <div className="box-header">
          <h2 className="box-title">{t('activity.categories')}</h2>
        </div>
        <div className="box-body">
          <CategoryBar items={u?.byCategory ?? []} />
        </div>
      </section>

      <section className="box mb-3">
        <div className="box-header">
          <h2 className="box-title grow">{t('activity.apps')}</h2>
          <span className="small muted">{t('activity.appsHint')}</span>
        </div>
        {apps.length === 0 ? (
          <Blankslate icon={<DeviceDesktopIcon size={24} />} title={t('activity.noApps')}>
            <p>{t('activity.noAppsText')}</p>
          </Blankslate>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('activity.app')}</th>
                  <th>{t('activity.category')}</th>
                  <th>{t('activity.time')}</th>
                  <th>{t('activity.share')}</th>
                  <th>{t('activity.streak')}</th>
                  <th>{t('activity.game')}</th>
                  <th>{t('activity.titles')}</th>
                  <th>{t('activity.ignore')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedApps.map((a) => (
                  <AppRow key={a.id} app={a} ms={usageByApp.get(a.id) ?? 0} total={u?.activeMs ?? 0} streak={streakByApp.get(a.id) ?? 0} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="box mb-3">
        <div className="box-header">
          <UnmuteIcon />
          <h2 className="box-title grow">{t('activity.music')}</h2>
          {m && m.totalMs > 0 && (
            <span className="small muted">
              {t('activity.musicTotal', { time: duration(m.totalMs) })} · {tn('activity.plays', m.plays)}
            </span>
          )}
        </div>
        {!m || (m.totalMs === 0 && !spotify.data) ? (
          <div className="box-body small muted">{t('activity.noMusic')}</div>
        ) : (
          <>
            {m.totalMs > 0 && (
              <div className="music-grid">
                <div>
                  <h3 className="mini-title">{t('activity.topArtists')}</h3>
                  {m.topArtists.slice(0, 6).map((a) => (
                    <div key={a.name} className="music-row">
                      <span className="grow truncate">{a.name}</span>
                      <span className="muted nowrap">{duration(a.ms)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className="mini-title">{t('activity.topTracks')}</h3>
                  {m.topTracks.slice(0, 6).map((tr) => (
                    <div key={`${tr.title}-${tr.artist}`} className="music-row">
                      <span className="grow truncate">
                        {tr.title}
                        {tr.artist && <span className="muted"> — {tr.artist}</span>}
                      </span>
                      <span className="muted nowrap">{duration(tr.ms)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className="mini-title">{t('activity.sources')}</h3>
                  {m.bySource.map((s) => (
                    <div key={s.source} className="music-row">
                      <span className="grow truncate">{(s.source.split(/[!\\/]/).pop() ?? s.source).replace(/\.exe$/i, '')}</span>
                      <span className="muted nowrap">{duration(s.ms)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {spotify.data && (
              <div className="box-footer">
                <h3 className="mini-title">{t('activity.spotify')}</h3>
                <div className="row row-wrap">
                  {spotify.data.topArtists.slice(0, 10).map((a) => (
                    <span key={a.name} className="spotify-chip">
                      {a.image && <img src={a.image} alt="" />}
                      {a.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="box mb-3">
        <div className="box-header">
          <ZapIcon />
          <h2 className="box-title grow">{t('activity.rules')}</h2>
          <Button
            size="small"
            onClick={async () => {
              const n = await api.reapplyRules()
              setNotice(t('activity.reapplied', { n }))
            }}
          >
            {t('activity.reapply')}
          </Button>
          <Button size="small" leadingVisual={PlusIcon} onClick={() => setRuleOpen(true)}>
            {t('activity.newRule')}
          </Button>
        </div>
        {notice && (
          <div className="box-row small" style={{ alignItems: 'center' }}>
            <CheckIcon className="fg-success" />
            {notice}
          </div>
        )}
        {(rules.data ?? []).length === 0 ? (
          <div className="box-body small muted">{t('activity.noRules')}</div>
        ) : (
          (rules.data ?? []).map((r) => <RuleRow key={r.id} rule={r} tasks={tasks.data ?? []} />)
        )}
      </section>

      <CategoriesBox />
      {ruleOpen && <RuleDialog onClose={() => setRuleOpen(false)} />}
    </div>
  )
}

function AppRow({ app, ms, total, streak }: { app: AppInfo; ms: number; total: number; streak: number }): ReactNode {
  const { categories, categoryById } = useApp()
  const { t, duration } = useI18n()
  const confirm = useConfirm()
  const color = categoryById.get(app.categoryId ?? -1)?.color
  const set = (patch: AppPatch): void => void api.updateApp(app.id, patch)
  const toggleTitles = async (on: boolean): Promise<void> => {
    if (on) return set({ recordTitles: true })
    const scrub = await confirm({
      title: t('activity.titlesOffTitle'),
      content: t('activity.titlesOffText'),
      confirmButtonContent: t('activity.titlesOffConfirm'),
      cancelButtonContent: t('activity.titlesOffKeep'),
      confirmButtonType: 'danger'
    })
    set({ recordTitles: false, scrubTitles: scrub })
  }
  return (
    <tr className={app.ignored ? 'muted-row' : undefined}>
      <td>
        <Link to={`/activity/apps/${app.id}`} className="row link-plain">
          <AppIcon icon={app.icon} name={app.displayName} color={color} />
          <div style={{ minWidth: 0 }}>
            <div className="truncate bold">{app.displayName}</div>
            <div className="small muted truncate" title={app.exePath}>
              {app.exeName}
            </div>
          </div>
        </Link>
      </td>
      <td>
        <Select size="small" value={String(app.categoryId ?? '')} onChange={(e) => set({ categoryId: e.target.value ? Number(e.target.value) : null })}>
          {categories.map((c) => (
            <Select.Option key={c.id} value={String(c.id)}>
              {categoryName(c, t)}
            </Select.Option>
          ))}
        </Select>
      </td>
      <td className="nowrap">{ms ? duration(ms) : '—'}</td>
      <td>
        <div className="share-bar">
          <span style={{ width: `${total ? (ms / total) * 100 : 0}%`, background: color }} />
        </div>
      </td>
      <td>
        <StreakBadge n={streak} />
      </td>
      <td>
        <Checkbox checked={app.isGame} onChange={(e) => set({ isGame: e.target.checked })} aria-label={t('activity.game')} />
      </td>
      <td>
        <Checkbox checked={app.recordTitles} onChange={(e) => void toggleTitles(e.target.checked)} aria-label={t('activity.titles')} />
      </td>
      <td>
        <Checkbox checked={app.ignored} onChange={(e) => set({ ignored: e.target.checked })} aria-label={t('activity.ignore')} />
      </td>
    </tr>
  )
}

function RuleRow({ rule, tasks }: { rule: Rule; tasks: Task[] }): ReactNode {
  const { appById, categoryById, goalById } = useApp()
  const { t } = useI18n()
  const app = rule.appId != null ? appById.get(rule.appId) : undefined
  const task = rule.taskId != null ? tasks.find((x) => x.id === rule.taskId) : undefined
  const goal = rule.goalId != null ? goalById.get(rule.goalId) : undefined
  const category = rule.categoryId != null ? categoryById.get(rule.categoryId) : undefined
  return (
    <div className="box-row hoverable" style={{ alignItems: 'center' }}>
      <div className="grow row row-wrap small">
        <span className="muted">{t('rules.if')}</span>
        {app ? (
          <span className="row" style={{ gap: 4 }}>
            <AppIcon icon={app.icon} name={app.displayName} size={16} />
            <strong>{app.displayName}</strong>
          </span>
        ) : (
          <strong>{t('rules.anyApp')}</strong>
        )}
        {rule.titlePattern && (
          <>
            <span className="muted">{t('rules.andTitle')}</span>
            <code className="mono">{rule.titlePattern}</code>
          </>
        )}
        <ArrowRightIcon size={14} />
        {task ? (
          <Link to={`/tasks/${task.number}`}>
            #{task.number} {task.title}
          </Link>
        ) : goal ? (
          <Link to={`/goals/${goal.id}`}>
            {goal.emoji} {goal.title}
          </Link>
        ) : category ? (
          <span className="row" style={{ gap: 4 }}>
            <span className="color-dot" style={{ background: category.color }} />
            {categoryName(category, t)}
          </span>
        ) : (
          '—'
        )}
      </div>
      <IconButton icon={TrashIcon} size="small" variant="invisible" aria-label={t('common.delete')} onClick={() => void api.deleteRule(rule.id)} />
    </div>
  )
}

function CategoriesBox(): ReactNode {
  const { categories } = useApp()
  const { t } = useI18n()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  return (
    <section className="box">
      <div className="box-header">
        <TagIcon />
        <h2 className="box-title grow">{t('activity.categoriesManage')}</h2>
        <Button size="small" leadingVisual={PlusIcon} onClick={() => setEditing('new')}>
          {t('activity.newCategory')}
        </Button>
      </div>
      {editing === 'new' && (
        <div className="box-row">
          <CategoryEditor onDone={() => setEditing(null)} />
        </div>
      )}
      {categories.map((c) =>
        editing === c.id ? (
          <div key={c.id} className="box-row">
            <CategoryEditor category={c} onDone={() => setEditing(null)} />
          </div>
        ) : (
          <div key={c.id} className="box-row hoverable" style={{ alignItems: 'center' }}>
            <span className="color-dot" style={{ background: c.color }} />
            <span className="grow">
              {categoryName(c, t)}
              {c.key && <span className="small muted"> · {t('activity.builtin')}</span>}
            </span>
            <Button size="small" variant="invisible" onClick={() => setEditing(c.id)}>
              {t('common.edit')}
            </Button>
            {!c.key && (
              <Button size="small" variant="invisible" onClick={() => void api.deleteCategory(c.id)}>
                {t('common.delete')}
              </Button>
            )}
          </div>
        )
      )}
    </section>
  )
}

function CategoryEditor({ category, onDone }: { category?: Category; onDone(): void }): ReactNode {
  const { t } = useI18n()
  const builtin = category?.key != null
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? COLOR_PALETTE[5])
  const save = useAction(async () => {
    await api.saveCategory({ id: category?.id, name: builtin ? category!.name : name, color })
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
      {!builtin && (
        <Field label={t('labels.name')}>
          <TextInput block autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <ColorField value={color} onChange={setColor} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={(!builtin && !name.trim()) || save.busy}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
