import { useMemo, type ReactNode } from 'react'
import { Button, IconButton, TextInput } from '@primer/react'
import {
  CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, ListUnorderedIcon, MoonIcon, PulseIcon, StopwatchIcon, SunIcon
} from '@primer/octicons-react'
import { useNavigate, useParams } from 'react-router'
import { buildAgenda, type AgendaBlock } from '@shared/schedule'
import { addDays, endOfDayMs, formatHM, startOfDayMs, todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { categoryName, dayLabel } from '../utils'
import { AppIcon, AppUsageList, Blankslate, CategoryBar, Stat } from '../components/common'
import { DayTimeline } from '../components/DayTimeline'

/** "What did I do that day": a visual timeline plus a readable agenda. */
export function SchedulePage(): ReactNode {
  const { date: param } = useParams()
  const navigate = useNavigate()
  const i18n = useI18n()
  const { t, duration } = i18n
  const { appById } = useApp()
  const today = todayKey()
  const day = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today
  const from = startOfDayMs(day)
  const to = endOfDayMs(day)
  const sessions = useQuery(() => api.listSessions(from, to), [day], ['activity', 'meta'])
  const entries = useQuery(() => api.listTimeEntries({ from, to }), [day], ['time'])
  const usage = useQuery(() => api.getUsage(from, to), [day], ['activity', 'time', 'tasks'])
  const agenda = useMemo(() => buildAgenda(sessions.data ?? [], { from, to }), [sessions.data, from, to])
  const go = (key: string): void => {
    void navigate(key === today ? '/schedule' : `/schedule/${key}`)
  }
  const u = usage.data
  const hasData = (sessions.data?.length ?? 0) > 0 || (entries.data?.length ?? 0) > 0

  return (
    <div className="container">
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">{t('schedule.title')}</h1>
          <div className="muted cap">{dayLabel(day, i18n, 'EEEE, d MMMM yyyy')}</div>
        </div>
        <IconButton icon={ChevronLeftIcon} aria-label={t('schedule.prev')} onClick={() => go(addDays(day, -1))} />
        <TextInput type="date" value={day} max={today} onChange={(e) => e.target.value && go(e.target.value)} aria-label={t('schedule.pickDate')} />
        <IconButton icon={ChevronRightIcon} aria-label={t('schedule.next')} disabled={day >= today} onClick={() => go(addDays(day, 1))} />
        <Button disabled={day === today} onClick={() => go(today)}>
          {t('common.today')}
        </Button>
      </div>

      <div className="stat-grid mb-3">
        <Stat icon={<PulseIcon size={14} />} label={t('schedule.active')} value={duration(u?.activeMs ?? 0)} />
        <Stat icon={<SunIcon size={14} />} label={t('schedule.first')} value={u?.firstActivity ? formatHM(u.firstActivity) : '—'} />
        <Stat icon={<MoonIcon size={14} />} label={t('schedule.last')} value={u?.lastActivity ? formatHM(u.lastActivity) : '—'} />
        <Stat icon={<StopwatchIcon size={14} />} label={t('schedule.taskTime')} value={duration(u?.taskMs ?? 0)} />
        <Stat icon={<CheckCircleIcon size={14} />} label={t('schedule.closed')} value={u?.tasksClosed ?? 0} />
      </div>

      {!hasData && !sessions.loading ? (
        <div className="box">
          <Blankslate icon={<ClockIcon size={24} />} title={t('schedule.emptyTitle')}>
            <p>{t(day === today ? 'schedule.emptyToday' : 'schedule.emptyText')}</p>
          </Blankslate>
        </div>
      ) : (
        <>
          <div className="schedule-grid">
            <div className="box">
              <DayTimeline day={day} sessions={sessions.data ?? []} entries={entries.data ?? []} />
            </div>
            <div className="box">
              <div className="box-header">
                <ListUnorderedIcon />
                <h2 className="box-title">{t('schedule.agenda')}</h2>
              </div>
              {agenda.length ? (
                agenda.map((b) => <AgendaRow key={`${b.appId}-${b.start}`} block={b} />)
              ) : (
                <div className="box-body small muted">{t('schedule.agendaEmpty')}</div>
              )}
            </div>
          </div>
          <div className="three-col mt-3">
            <section className="box">
              <div className="box-header">
                <h2 className="box-title">{t('schedule.categories')}</h2>
              </div>
              <div className="box-body">
                <CategoryBar items={u?.byCategory ?? []} />
              </div>
            </section>
            <section className="box">
              <div className="box-header">
                <h2 className="box-title">{t('schedule.topApps')}</h2>
              </div>
              <div className="box-body">
                <AppUsageList items={u?.byApp ?? []} limit={8} />
              </div>
            </section>
            <section className="box">
              <div className="box-header">
                <h2 className="box-title">{t('schedule.topTitles')}</h2>
              </div>
              {(u?.byTitle ?? []).slice(0, 8).map((x) => {
                const app = appById.get(x.appId)
                return (
                  <div key={`${x.appId}-${x.title}`} className="box-row small" style={{ alignItems: 'center' }}>
                    <AppIcon icon={app?.icon} name={app?.displayName ?? '?'} size={16} />
                    <span className="truncate grow" title={x.title}>
                      {x.title}
                    </span>
                    <span className="muted nowrap">{duration(x.ms)}</span>
                  </div>
                )
              })}
              {!u?.byTitle.length && <div className="box-body small muted">{t('common.noActivity')}</div>}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function AgendaRow({ block }: { block: AgendaBlock }): ReactNode {
  const { appById, categoryById } = useApp()
  const { t, duration } = useI18n()
  const app = appById.get(block.appId)
  const cat = categoryById.get(block.categoryId)
  return (
    <div className="agenda-row">
      <span className="mono small">
        {formatHM(block.start)}–{formatHM(block.end)}
      </span>
      <AppIcon icon={app?.icon} name={app?.displayName ?? '?'} color={cat?.color} />
      <div style={{ minWidth: 0 }}>
        <div className="row">
          <span className="bold truncate">{app?.displayName ?? '?'}</span>
          <span className="color-dot" style={{ background: cat?.color }} title={categoryName(cat, t)} />
        </div>
        {block.titles.slice(0, 2).map((x) => (
          <div key={x.title} className="small muted truncate" title={x.title}>
            {x.title}
          </div>
        ))}
      </div>
      <span className="small muted nowrap">{duration(block.activeMs)}</span>
    </div>
  )
}
