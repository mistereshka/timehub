import { useMemo, useState, type ReactNode } from 'react'
import { Button, Checkbox, IconButton, SegmentedControl, Select, TextInput, useConfirm } from '@primer/react'
import {
  ArrowRightIcon, CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, DeviceDesktopIcon, PlusIcon, PulseIcon, StopwatchIcon,
  TagIcon, TrashIcon, ZapIcon
} from '@primer/octicons-react'
import { Link } from 'react-router'
import type { AppInfo, AppPatch, Category, Rule, Task } from '@shared/types'
import { COLOR_PALETTE } from '@shared/catalog'
import { addDays, dayKey, endOfDayMs, parseDayKey, startOfDayMs, startOfWeek, todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { categoryName, dayLabel } from '../utils'
import { AppIcon, Blankslate, CategoryBar, ColorField, ErrorFlash, Field, Stat } from '../components/common'
import { DayBars } from '../components/DayBars'
import { RuleDialog } from '../components/RuleDialog'

type Period = 'day' | 'week' | 'month'
const PERIODS: Period[] = ['day', 'week', 'month']

function periodRange(period: Period, anchor: string, weekStartsOn: 0 | 1): { from: string; to: string } {
  if (period === 'day') return { from: anchor, to: anchor }
  if (period === 'week') {
    const from = startOfWeek(anchor, weekStartsOn)
    return { from, to: addDays(from, 6) }
  }
  const d = parseDayKey(anchor)
  return { from: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), to: dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
}

function shiftAnchor(period: Period, anchor: string, dir: 1 | -1): string {
  if (period === 'day') return addDays(anchor, dir)
  if (period === 'week') return addDays(anchor, 7 * dir)
  const d = parseDayKey(anchor)
  return dayKey(new Date(d.getFullYear(), d.getMonth() + dir, 1))
}

export function ActivityPage(): ReactNode {
  const { settings, apps, categoryById } = useApp()
  const i18n = useI18n()
  const { t, date, duration } = i18n
  const today = todayKey()
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(today)
  const range = useMemo(() => periodRange(period, anchor, settings.weekStartsOn), [period, anchor, settings.weekStartsOn])
  const from = startOfDayMs(range.from)
  const to = endOfDayMs(range.to)
  const usage = useQuery(() => api.getUsage(from, to), [from, to], ['activity', 'meta', 'time'])
  const daily = useQuery(() => api.getDailyActive(range.from, range.to), [range.from, range.to], ['activity'])
  const rules = useQuery(() => api.listRules(), [], ['meta'])
  const tasks = useQuery(() => api.listTasks(), [], ['tasks'])
  const [ruleOpen, setRuleOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const u = usage.data
  const days = daily.data ?? []
  const activeDays = days.filter((d) => d.value > 0).length
  const usageByApp = new Map((u?.byApp ?? []).map((i) => [i.id, i.ms]))
  const sortedApps = [...apps].sort(
    (a, b) => (usageByApp.get(b.id) ?? 0) - (usageByApp.get(a.id) ?? 0) || a.displayName.localeCompare(b.displayName)
  )
  const topCategory = u?.byCategory[0]
  const periodTitle =
    period === 'day'
      ? dayLabel(range.from, i18n, 'EEEE, d MMMM yyyy')
      : period === 'week'
        ? `${date(range.from, 'd MMM')} – ${date(range.to, 'd MMM yyyy')}`
        : date(range.from, 'LLLL yyyy')

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title grow">{t('activity.title')}</h1>
        <SegmentedControl aria-label={t('activity.period')} onChange={(i) => setPeriod(PERIODS[i])}>
          <SegmentedControl.Button selected={period === 'day'}>{t('activity.day')}</SegmentedControl.Button>
          <SegmentedControl.Button selected={period === 'week'}>{t('activity.week')}</SegmentedControl.Button>
          <SegmentedControl.Button selected={period === 'month'}>{t('activity.month')}</SegmentedControl.Button>
        </SegmentedControl>
        <IconButton icon={ChevronLeftIcon} aria-label={t('activity.prev')} onClick={() => setAnchor(shiftAnchor(period, anchor, -1))} />
        <span className="bold nowrap period-title cap">{periodTitle}</span>
        <IconButton
          icon={ChevronRightIcon}
          aria-label={t('activity.next')}
          disabled={range.to >= today}
          onClick={() => setAnchor(shiftAnchor(period, anchor, 1))}
        />
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
            <h2 className="box-title">{t('activity.perDay')}</h2>
          </div>
          <div className="box-body">
            <DayBars days={days} />
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
                  <th>{t('activity.game')}</th>
                  <th>{t('activity.titles')}</th>
                  <th>{t('activity.ignore')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedApps.map((a) => (
                  <AppRow key={a.id} app={a} ms={usageByApp.get(a.id) ?? 0} total={u?.activeMs ?? 0} />
                ))}
              </tbody>
            </table>
          </div>
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

function AppRow({ app, ms, total }: { app: AppInfo; ms: number; total: number }): ReactNode {
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
        <div className="row">
          <AppIcon icon={app.icon} name={app.displayName} color={color} />
          <div style={{ minWidth: 0 }}>
            <div className="truncate bold">{app.displayName}</div>
            <div className="small muted truncate" title={app.exePath}>
              {app.exeName}
            </div>
          </div>
        </div>
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
  const { appById, categoryById } = useApp()
  const { t } = useI18n()
  const app = rule.appId != null ? appById.get(rule.appId) : undefined
  const task = rule.taskId != null ? tasks.find((x) => x.id === rule.taskId) : undefined
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
