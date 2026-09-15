import { useState, type ReactNode } from 'react'
import { SegmentedControl } from '@primer/react'
import { CommentDiscussionIcon, FlameIcon, HourglassIcon } from '@primer/octicons-react'
import { addDays, endOfDayMs, formatHM, startOfDayMs, todayKey } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useNow, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { AppIcon, Stat } from '../components/common'
import { Bars } from '../components/Bars'

type Period = 'day' | 'week' | 'month'
const PERIODS: Period[] = ['day', 'week', 'month']

/** Messaging and calls in Telegram, Discord and other messengers: how much, with whom, when. */
export function SocialPage(): ReactNode {
  const { t, tn, duration, ago, date } = useI18n()
  const { tracker } = useApp()
  const now = useNow(15_000)
  const [period, setPeriod] = useState<Period>('week')
  const today = todayKey()
  const from = startOfDayMs(period === 'day' ? today : addDays(today, period === 'week' ? -6 : -29))
  const to = endOfDayMs(today)
  const social = useQuery(() => api.getSocial(from, to), [from, to], ['activity', 'social'])
  const s = social.data
  const call = tracker.call
  const topChat = s?.chats[0]?.ms ?? 0

  return (
    <div className="container">
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">{t('social.title')}</h1>
          <div className="muted">{t('social.subtitle')}</div>
        </div>
        <SegmentedControl aria-label={t('activity.period')} onChange={(i) => setPeriod(PERIODS[i])}>
          {PERIODS.map((p) => (
            <SegmentedControl.Button key={p} selected={period === p}>
              {t(`activity.${p}` as MessageKey)}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
      </div>

      {call && (
        <div className="box call-live mb-3">
          <span className="call-live-icon" aria-hidden="true">
            📞
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold">{t('social.inCall', { app: call.app })}</div>
            {call.context && <div className="muted truncate">{call.context}</div>}
          </div>
          <span className="call-live-time mono">{duration(now - call.since)}</span>
        </div>
      )}

      <div className="stat-grid mb-3">
        <Stat icon={<CommentDiscussionIcon size={14} />} label={t('social.messaging')} value={duration(s?.messagingMs ?? 0)} />
        <Stat icon={<span aria-hidden="true">📞</span>} label={t('social.calls')} value={`${s?.callCount ?? 0} · ${duration(s?.callMs ?? 0)}`} />
        <Stat icon={<HourglassIcon size={14} />} label={t('social.longest')} value={duration(s?.longestCallMs ?? 0)} />
        <Stat icon={<FlameIcon size={14} />} label={t('social.streak')} value={tn('common.days', s?.streak ?? 0)} />
      </div>

      {period !== 'day' && s && (
        <section className="box mb-3">
          <div className="box-header">
            <h2 className="box-title">{t('social.perDay')}</h2>
          </div>
          <div className="box-body">
            <Bars
              items={s.daily.map((d) => ({
                key: d.date,
                label: date(d.date, period === 'week' ? 'EEEEEE' : 'd'),
                value: d.messagingMs + d.callMs,
                title: `${date(d.date, 'd MMMM')}: ${duration(d.messagingMs)} · 📞 ${duration(d.callMs)}`
              }))}
              format={(v) => duration(v)}
            />
          </div>
        </section>
      )}

      <div className="schedule-grid">
        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('social.chats')}</h2>
          </div>
          {!s?.chats.length && <div className="box-body small muted">{t('social.noChats')}</div>}
          {s?.chats.map((c) => (
            <div key={`${c.appId}-${c.kind}-${c.name}`} className="box-row" style={{ alignItems: 'center' }}>
              <AppIcon icon={c.icon} name={c.app} size={20} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="bold truncate">{c.name}</span>
                  <span className="social-kind">{t(`social.kind.${c.kind}` as MessageKey)}</span>
                </div>
                <div className="small muted truncate">
                  {[c.app, c.detail, ago(c.last)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="share-bar">
                <span style={{ width: `${topChat ? (c.ms / topChat) * 100 : 0}%`, background: 'var(--fgColor-success)' }} />
              </div>
              <span className="small muted nowrap">{duration(c.ms)}</span>
            </div>
          ))}
        </section>

        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('social.calls')}</h2>
          </div>
          {!s?.calls.length && <div className="box-body small muted">{t('social.noCalls')}</div>}
          {s?.calls.map((c) => (
            <div key={c.id} className="box-row" style={{ alignItems: 'center' }}>
              <AppIcon icon={c.icon} name={c.app} size={20} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold truncate">{c.context || c.app}</div>
                <div className="small muted">
                  {c.context ? `${c.app} · ` : ''}
                  {date(c.start, 'd MMM')}, {formatHM(c.start)}–{formatHM(c.end)}
                </div>
              </div>
              <span className="small nowrap">{duration(c.end - c.start)}</span>
            </div>
          ))}
        </section>
      </div>

      {s && s.byApp.length > 0 && (
        <section className="box mt-3">
          <div className="box-header">
            <h2 className="box-title">{t('social.apps')}</h2>
          </div>
          {s.byApp.map((a) => (
            <div key={a.appId} className="box-row small" style={{ alignItems: 'center' }}>
              <AppIcon icon={a.icon} name={a.name} size={20} />
              <span className="grow bold truncate">{a.name}</span>
              <span className="muted nowrap">{duration(a.ms)}</span>
              <span className="muted nowrap">{a.calls ? `📞 ${tn('social.callsCount', a.calls)} · ${duration(a.callMs)}` : ''}</span>
            </div>
          ))}
        </section>
      )}
      <p className="small muted mt-2">{t('social.privacy')}</p>
    </div>
  )
}
