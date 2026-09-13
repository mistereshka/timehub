import { useMemo, type ReactNode } from 'react'
import { SegmentedControl, Timeline } from '@primer/react'
import { CheckCircleIcon, FlameIcon, IssueClosedIcon, IssueOpenedIcon, PulseIcon, StopwatchIcon } from '@primer/octicons-react'
import { Link, useNavigate } from 'react-router'
import type { FeedEvent, HeatmapMetric } from '@shared/types'
import { HOUR, addDays, dayKey, endOfDayMs, formatHM, startOfDayMs, todayKey } from '@shared/time'
import { buildHeatmap } from '@shared/heatmap'
import { api } from '../api'
import { useApp } from '../context'
import { useNow, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { dayLabel } from '../utils'
import { AppUsageList, Blankslate, CategoryBar, Stat } from '../components/common'
import { DayBars } from '../components/DayBars'
import { HeatLegend, Heatmap } from '../components/Heatmap'

const METRICS: HeatmapMetric[] = ['active', 'tasks']

export function OverviewPage(): ReactNode {
  const { settings, updateSettings } = useApp()
  const { t, tn, date, duration } = useI18n()
  const navigate = useNavigate()
  const minute = Math.floor(useNow(60_000) / 60_000)
  const today = todayKey()
  const metric = settings.heatmapMetric
  const heat = useQuery(() => api.getHeatmap(metric, addDays(today, -380), today), [metric, today, minute], ['tasks'])
  const usage = useQuery(() => api.getUsage(startOfDayMs(today), endOfDayMs(today)), [today], ['activity', 'time', 'tasks'])
  const week = useQuery(() => api.getDailyActive(addDays(today, -6), today), [today, minute])
  const feed = useQuery(() => api.getFeed(14), [minute], ['tasks', 'time'])
  const heatmap = useMemo(
    () => (heat.data ? buildHeatmap(heat.data, today, settings.weekStartsOn) : null),
    [heat.data, today, settings.weekStartsOn]
  )
  const u = usage.data
  const summary = heatmap
    ? metric === 'active'
      ? tn('heatmap.summaryActive', Math.round(heatmap.total / HOUR))
      : tn('heatmap.summaryTasks', heatmap.total)
    : ''

  return (
    <div className="container">
      <div className="layout-sidebar-left">
        <aside className="stack">
          <div>
            <h1 className="page-title">{t('overview.title')}</h1>
            <div className="muted cap">{date(today, 'EEEE, d MMMM')}</div>
          </div>
          <div className="stat-grid two">
            <Stat icon={<PulseIcon size={14} />} label={t('overview.active')} value={duration(u?.activeMs ?? 0)} />
            <Stat icon={<CheckCircleIcon size={14} />} label={t('overview.tasksDone')} value={u?.tasksClosed ?? 0} />
            <Stat icon={<StopwatchIcon size={14} />} label={t('overview.tracked')} value={duration(u?.taskMs ?? 0)} />
            <Stat icon={<FlameIcon size={14} />} label={t('overview.streak')} value={tn('common.days', heatmap?.currentStreak ?? 0)} />
          </div>
          <section>
            <h2 className="section-title">{t('overview.topApps')}</h2>
            <AppUsageList items={u?.byApp ?? []} />
          </section>
          <section>
            <h2 className="section-title">{t('overview.categories')}</h2>
            <CategoryBar items={u?.byCategory ?? []} />
          </section>
        </aside>

        <div className="stack">
          <section>
            <div className="row mb-2">
              <h2 className="section-title grow m-0">{summary}</h2>
              <SegmentedControl size="small" aria-label={t('heatmap.metric')} onChange={(i) => void updateSettings({ heatmapMetric: METRICS[i] })}>
                <SegmentedControl.Button selected={metric === 'active'}>{t('heatmap.metricActive')}</SegmentedControl.Button>
                <SegmentedControl.Button selected={metric === 'tasks'}>{t('heatmap.metricTasks')}</SegmentedControl.Button>
              </SegmentedControl>
            </div>
            <div className="box box-body">
              {heatmap && (
                <Heatmap heatmap={heatmap} metric={metric} weekStartsOn={settings.weekStartsOn} onSelect={(d) => navigate(`/schedule/${d}`)} />
              )}
              <div className="row mt-2 small muted">
                <span className="grow">
                  {heatmap && `${tn('heatmap.longest', heatmap.longestStreak)} · ${tn('heatmap.current', heatmap.currentStreak)}`}
                </span>
                <HeatLegend />
              </div>
            </div>
          </section>
          <section>
            <h2 className="section-title">{t('overview.thisWeek')}</h2>
            <div className="box box-body">
              <DayBars days={week.data ?? []} />
            </div>
          </section>
          <section>
            <h2 className="section-title">{t('overview.feed')}</h2>
            <Feed events={feed.data ?? []} />
          </section>
        </div>
      </div>
    </div>
  )
}

function Feed({ events }: { events: FeedEvent[] }): ReactNode {
  const i18n = useI18n()
  const { t } = i18n
  if (!events.length) {
    return (
      <div className="box">
        <Blankslate icon={<PulseIcon size={24} />} title={t('overview.feedEmpty')}>
          <p>{t('overview.feedEmptyText')}</p>
        </Blankslate>
      </div>
    )
  }
  const groups = new Map<string, FeedEvent[]>()
  for (const e of events) groups.set(dayKey(e.at), [...(groups.get(dayKey(e.at)) ?? []), e])
  return (
    <div className="feed">
      {[...groups].map(([day, list]) => (
        <div key={day} className="feed-group">
          <h3 className="feed-day">{dayLabel(day, i18n, 'EEEE, d MMMM')}</h3>
          <Timeline>
            {list.map((e, i) => (
              <FeedItem key={`${e.kind}-${e.at}-${i}`} event={e} />
            ))}
          </Timeline>
        </div>
      ))}
    </div>
  )
}

function TaskLink({ number, title }: { number: number; title: string }): ReactNode {
  return (
    <Link to={`/tasks/${number}`} className="bold link-plain">
      {title} <span className="muted">#{number}</span>
    </Link>
  )
}

function FeedItem({ event: e }: { event: FeedEvent }): ReactNode {
  const { t, duration } = useI18n()
  const { appById } = useApp()
  let icon: ReactNode
  let body: ReactNode
  switch (e.kind) {
    case 'task_created':
      icon = <IssueOpenedIcon className="fg-success" />
      body = (
        <>
          {t('feed.created')} <TaskLink number={e.number} title={e.title} />
        </>
      )
      break
    case 'task_closed':
      icon = <IssueClosedIcon className="fg-done" />
      body = (
        <>
          {t('feed.closed')} <TaskLink number={e.number} title={e.title} />
        </>
      )
      break
    case 'time_logged':
      icon = <StopwatchIcon />
      body = (
        <>
          {t('feed.logged', { time: duration(e.ms) })} <TaskLink number={e.number} title={e.title} />
        </>
      )
      break
    case 'day_summary': {
      const app = e.topAppId != null ? appById.get(e.topAppId) : undefined
      icon = <PulseIcon />
      body = (
        <Link className="link-plain" to={`/schedule/${e.date}`}>
          {t('feed.daySummary', { time: duration(e.activeMs) })}
          {app ? ` · ${t('feed.mostlyIn', { app: app.displayName, time: duration(e.topAppMs) })}` : ''}
        </Link>
      )
      break
    }
  }
  return (
    <Timeline.Item condensed>
      <Timeline.Badge>{icon}</Timeline.Badge>
      <Timeline.Body>
        <div className="row">
          <span className="grow">{body}</span>
          <span className="muted small nowrap">{formatHM(e.at)}</span>
        </div>
      </Timeline.Body>
    </Timeline.Item>
  )
}
