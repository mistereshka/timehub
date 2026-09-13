import { useMemo, type ReactNode } from 'react'
import { SegmentedControl, Timeline } from '@primer/react'
import {
  CheckCircleIcon, FlameIcon, IssueClosedIcon, IssueOpenedIcon, MarkGithubIcon, NoteIcon, PulseIcon, StopwatchIcon, TrophyIcon
} from '@primer/octicons-react'
import { Link, useNavigate } from 'react-router'
import type { FeedEvent, HeatmapMetric } from '@shared/types'
import { HOUR, addDays, dayKey, endOfDayMs, formatHM, startOfDayMs, todayKey } from '@shared/time'
import { buildHeatmap } from '@shared/heatmap'
import { api } from '../api'
import { useApp } from '../context'
import { useNow, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { dayLabel } from '../utils'
import { AppUsageList, Blankslate, CategoryBar, MiniProgress, Stat } from '../components/common'
import { DayBars } from '../components/DayBars'
import { HeatLegend, Heatmap } from '../components/Heatmap'

const METRIC_LABEL: Record<HeatmapMetric, MessageKey> = {
  active: 'heatmap.metricActive',
  tasks: 'heatmap.metricTasks',
  github: 'heatmap.metricGithub'
}

export function OverviewPage(): ReactNode {
  const { settings, updateSettings, goals } = useApp()
  const { t, tn, date, duration } = useI18n()
  const navigate = useNavigate()
  const minute = Math.floor(useNow(60_000) / 60_000)
  const today = todayKey()
  const conns = useQuery(() => api.listConnections(), [], ['connections'])
  const githubOn = (conns.data ?? []).some((c) => c.key === 'github' && c.enabled && c.connected)
  const metrics: HeatmapMetric[] = githubOn ? ['active', 'tasks', 'github'] : ['active', 'tasks']
  const metric: HeatmapMetric = metrics.includes(settings.heatmapMetric) ? settings.heatmapMetric : 'active'
  const heat = useQuery(() => api.getHeatmap(metric, addDays(today, -380), today), [metric, today, minute], ['tasks', 'external'])
  const usage = useQuery(() => api.getUsage(startOfDayMs(today), endOfDayMs(today)), [today], ['activity', 'time', 'tasks'])
  const week = useQuery(() => api.getDailyActive(addDays(today, -6), today), [today, minute])
  const feed = useQuery(() => api.getFeed(14), [minute], ['tasks', 'time', 'goals', 'external'])
  const heatmap = useMemo(
    () => (heat.data ? buildHeatmap(heat.data, today, settings.weekStartsOn) : null),
    [heat.data, today, settings.weekStartsOn]
  )
  const u = usage.data
  const activeGoals = goals.filter((g) => g.status === 'active')
  const summary = heatmap
    ? metric === 'active'
      ? tn('heatmap.summaryActive', Math.round(heatmap.total / HOUR))
      : metric === 'tasks'
        ? tn('heatmap.summaryTasks', heatmap.total)
        : tn('heatmap.summaryGithub', heatmap.total)
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
            <div className="row mb-2">
              <h2 className="section-title grow m-0">{t('overview.goals')}</h2>
              <Link className="small" to="/goals">
                {t('overview.allGoals')}
              </Link>
            </div>
            {activeGoals.length ? (
              activeGoals.slice(0, 4).map((g) => (
                <Link key={g.id} className="goal-mini link-plain" to={`/goals/${g.id}`}>
                  <span>{g.emoji}</span>
                  <span className="grow truncate">{g.title}</span>
                  <MiniProgress value={g.progress / 100} color={g.color} />
                  <span className="small muted nowrap">{g.progress}%</span>
                </Link>
              ))
            ) : (
              <p className="small muted m-0">{t('overview.noGoals')}</p>
            )}
          </section>
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
              <SegmentedControl size="small" aria-label={t('heatmap.metric')} onChange={(i) => void updateSettings({ heatmapMetric: metrics[i] })}>
                {metrics.map((mt) => (
                  <SegmentedControl.Button key={mt} selected={metric === mt}>
                    {t(METRIC_LABEL[mt])}
                  </SegmentedControl.Button>
                ))}
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

function GoalLink({ id, title }: { id: number; title: string }): ReactNode {
  return (
    <Link to={`/goals/${id}`} className="bold link-plain">
      🎯 {title}
    </Link>
  )
}

function FeedItem({ event: e }: { event: FeedEvent }): ReactNode {
  const { t, tn, duration } = useI18n()
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
          {t('feed.logged', { time: duration(e.ms) })}{' '}
          {e.number != null ? <TaskLink number={e.number} title={e.title} /> : <GoalLink id={e.goalId!} title={e.title} />}
        </>
      )
      break
    case 'goal_note':
      icon = <NoteIcon />
      body = (
        <>
          {t('feed.goalNote')} <GoalLink id={e.goalId} title={e.title} />
          <div className="small muted truncate">{e.body.slice(0, 160)}</div>
        </>
      )
      break
    case 'goal_achieved':
      icon = <TrophyIcon className="fg-done" />
      body = (
        <>
          {t('feed.goalAchieved')} <GoalLink id={e.goalId} title={e.title} />
        </>
      )
      break
    case 'external':
      icon = <MarkGithubIcon />
      body = <>{tn('feed.github', e.value)}</>
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
          <span className="grow" style={{ minWidth: 0 }}>
            {body}
          </span>
          <span className="muted small nowrap">{formatHM(e.at)}</span>
        </div>
      </Timeline.Body>
    </Timeline.Item>
  )
}
