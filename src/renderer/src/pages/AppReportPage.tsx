import type { ReactNode } from 'react'
import { Button, Select } from '@primer/react'
import {
  ArrowLeftIcon, CalendarIcon, ClockIcon, FlameIcon, HistoryIcon, HourglassIcon, LinkExternalIcon, PeopleIcon, PulseIcon, RocketIcon,
  StopwatchIcon
} from '@primer/octicons-react'
import { Link, useParams } from 'react-router'
import type { AppReport } from '@shared/types'
import { buildHeatmap } from '@shared/heatmap'
import { todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { categoryName, libraryStatusLabel, weekdayName } from '../utils'
import { AppIcon, Blankslate, Stat } from '../components/common'
import { Bars } from '../components/Bars'
import { DotaPanel } from '../components/DotaPanel'
import { HeatLegend, Heatmap } from '../components/Heatmap'

/** Everything about one app or game, for all time. */
export function AppReportPage(): ReactNode {
  const { id } = useParams()
  const appId = Number(id)
  const { t } = useI18n()
  const report = useQuery(() => api.getAppReport(appId), [appId], ['activity', 'meta'])
  if (!report.data) {
    if (report.loading && !report.error) return null
    return (
      <div className="container container-narrow">
        <Blankslate icon={<PulseIcon size={24} />} title={t('report.notFound')}>
          <p>
            <Link to="/activity">{t('report.back')}</Link>
          </p>
        </Blankslate>
      </div>
    )
  }
  return <Report report={report.data} />
}

function Report({ report }: { report: AppReport }): ReactNode {
  const { settings, categories, categoryById } = useApp()
  const i18n = useI18n()
  const { t, tn, duration, date } = i18n
  const app = report.app
  const info = useQuery(() => api.getGameInfo(app.id), [app.id])
  const library = useQuery(() => api.listLibrary({ kind: 'game' }), [], ['library'])
  const libItem = (library.data ?? []).find((i) => i.appId === app.id)
  const color = categoryById.get(app.categoryId ?? -1)?.color
  const today = todayKey()
  const heat = buildHeatmap(report.daily, today, settings.weekStartsOn)
  const link = info.data?.link ?? report.link
  const hourLabel = (h: number): string => (h % 3 === 0 ? String(h) : '')

  return (
    <div className="container">
      <Link to="/activity" className="small link-plain row mb-2" style={{ gap: 4 }}>
        <ArrowLeftIcon size={14} />
        {t('report.back')}
      </Link>
      <div className="page-head">
        <AppIcon icon={app.icon} name={app.displayName} size={48} color={color} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h1 className="page-title truncate">{link?.name ?? app.displayName}</h1>
          <div className="small muted truncate" title={app.exePath}>
            {app.exePath.startsWith('site:') ? app.exeName : app.exePath}
          </div>
        </div>
        <Select value={String(app.categoryId ?? '')} onChange={(e) => void api.updateApp(app.id, { categoryId: e.target.value ? Number(e.target.value) : null })}>
          {categories.map((c) => (
            <Select.Option key={c.id} value={String(c.id)}>
              {categoryName(c, t)}
            </Select.Option>
          ))}
        </Select>
      </div>

      {link && (
        <div className="box game-banner mb-3">
          {link.imageUrl && <img src={link.imageUrl} alt="" className="game-banner-img" draggable={false} />}
          <div className="game-banner-body">
            <div className="presence-kicker">{link.provider.toUpperCase()}</div>
            {info.data?.details && <div className="bold">{info.data.details}</div>}
            {info.data?.playersOnline != null && (
              <div className="row">
                <PeopleIcon size={14} /> {tn('presence.players', info.data.playersOnline)}
              </div>
            )}
            {info.data?.platformPlaytimeMin != null && info.data.platformPlaytimeMin > 0 && (
              <div className="row">
                <RocketIcon size={14} /> {t('presence.steamHours', { n: Math.round(info.data.platformPlaytimeMin / 60) })}
              </div>
            )}
            {libItem && <div className="small muted">{t('report.inLibrary', { status: libraryStatusLabel(libItem.status, 'game', t) })}</div>}
            {link.storeUrl && (
              <div>
                <Button size="small" leadingVisual={LinkExternalIcon} onClick={() => void api.openExternal(link.storeUrl!)}>
                  {t(link.provider === 'roblox' ? 'presence.openRoblox' : 'presence.openStore')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {link?.provider === 'steam' && link.externalId === '570' && <DotaPanel />}

      <div className="stat-grid mb-3">
        <Stat icon={<ClockIcon size={14} />} label={t('report.total')} value={duration(report.totalMs)} />
        <Stat icon={<CalendarIcon size={14} />} label={t('report.days')} value={report.activeDays} />
        <Stat icon={<PulseIcon size={14} />} label={t('report.avg')} value={duration(report.avgPerActiveDayMs)} />
        <Stat icon={<HourglassIcon size={14} />} label={t('report.longest')} value={duration(report.longestRunMs)} />
        <Stat icon={<FlameIcon size={14} />} label={t('report.streak')} value={`${tn('common.days', report.streak)} · ${t('report.best', { n: report.bestStreak })}`} />
        <Stat icon={<StopwatchIcon size={14} />} label={t('report.sessions')} value={report.sessions} />
        <Stat icon={<HistoryIcon size={14} />} label={t('report.first')} value={report.firstSeen ? date(report.firstSeen, 'd MMM yyyy') : '—'} />
        <Stat icon={<HistoryIcon size={14} />} label={t('report.last')} value={report.lastUsed ? date(report.lastUsed, 'd MMM, HH:mm') : '—'} />
      </div>

      <section className="box box-body mb-3">
        <h2 className="section-title">{t('report.heatmap')}</h2>
        <Heatmap heatmap={heat} metric="active" weekStartsOn={settings.weekStartsOn} />
        <div className="row mt-2 small muted">
          <span className="grow" />
          <HeatLegend />
        </div>
      </section>

      <div className="three-col mb-3">
        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('report.months')}</h2>
          </div>
          <div className="box-body">
            <Bars
              items={report.monthly.map((m) => {
                const [y, mo] = m.month.split('-').map(Number)
                return { key: m.month, label: date(new Date(y, mo - 1, 1), 'LLL'), value: m.value, title: `${date(new Date(y, mo - 1, 1), 'LLLL yyyy')}: ${duration(m.value)}` }
              })}
            />
          </div>
        </section>
        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('report.hours')}</h2>
          </div>
          <div className="box-body">
            <Bars items={report.byHour.map((v, h) => ({ key: String(h), label: hourLabel(h), value: v, title: `${h}:00–${h + 1}:00: ${duration(v)}` }))} />
          </div>
        </section>
        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('report.weekdays')}</h2>
          </div>
          <div className="box-body">
            <Bars items={report.byWeekday.map((v, i) => ({ key: String(i), label: weekdayName(i, i18n), value: v }))} format={(v) => duration(v)} />
          </div>
        </section>
      </div>

      <div className={report.projects.length ? 'schedule-grid' : ''}>
        {report.projects.length > 0 && (
          <section className="box">
            <div className="box-header">
              <h2 className="box-title">{t('report.projects')}</h2>
            </div>
            {report.projects.map((p) => (
              <div key={p.name} className="box-row small" style={{ alignItems: 'center' }}>
                <span className="grow truncate bold">{p.name}</span>
                <div className="share-bar">
                  <span style={{ width: `${(p.ms / report.projects[0].ms) * 100}%`, background: color }} />
                </div>
                <span className="muted nowrap">{duration(p.ms)}</span>
              </div>
            ))}
          </section>
        )}
        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('report.windows')}</h2>
          </div>
          {report.topTitles.length === 0 && <div className="box-body small muted">{t('common.noActivity')}</div>}
          {report.topTitles.map((x) => (
            <div key={x.title} className="box-row small" style={{ alignItems: 'center' }}>
              <span className="grow truncate" title={x.title}>
                {x.title}
              </span>
              <span className="muted nowrap">{duration(x.ms)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
