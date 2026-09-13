import type { ReactNode } from 'react'
import type { ActivitySession, TimeEntry } from '@shared/types'
import { DAY, HOUR, MINUTE, formatHM, pad2, startOfDayMs, todayKey } from '@shared/time'
import { buildAgenda } from '@shared/schedule'
import { useApp } from '../context'
import { useNow } from '../hooks'
import { useI18n } from '../i18n'
import { categoryName } from '../utils'
import { AppIcon } from './common'

const HOUR_PX = 56

/** Vertical day view: app activity on the left lane, task time on the right. */
export function DayTimeline({ day, sessions, entries }: { day: string; sessions: ActivitySession[]; entries: TimeEntry[] }): ReactNode {
  const { appById, categoryById } = useApp()
  const { t, duration } = useI18n()
  const now = useNow(30_000)
  const from = startOfDayMs(day)
  const isToday = day === todayKey(now)

  const spans = [...sessions.map((s) => [s.start, s.end]), ...entries.map((e) => [e.start, e.end ?? now])].flat()
  const minH = spans.length ? Math.floor((Math.max(from, Math.min(...spans)) - from) / HOUR) : 8
  const maxH = spans.length ? Math.ceil((Math.min(from + DAY, Math.max(...spans)) - from) / HOUR) : 20
  const firstHour = Math.max(0, Math.min(8, minH))
  const lastHour = Math.min(24, Math.max(20, maxH, isToday ? Math.ceil((now - from) / HOUR) : 0))
  const y = (ts: number): number => ((Math.max(from, ts) - from) / HOUR - firstHour) * HOUR_PX
  const height = (lastHour - firstHour) * HOUR_PX
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i)

  const blocks = buildAgenda(sessions, { from, to: from + DAY, noiseMs: 0, mergeGapMs: MINUTE, minBlockMs: 0 })

  return (
    <div className="tl-wrap">
      <div className="tl-head">
        <div className="lane-title" />
        <div className="lane-title">{t('schedule.laneApps')}</div>
        <div className="lane-title">{t('schedule.laneTasks')}</div>
      </div>
      <div className="day-timeline" style={{ height: height + 12 }}>
        <div className="hours">
          {hours.map((h) => (
            <span key={h} className="hour-label" style={{ top: (h - firstHour) * HOUR_PX }}>
              {pad2(h % 24)}:00
            </span>
          ))}
        </div>
        {[0, 1].map((lane) => (
          <div key={lane} className="lane">
            {hours.map((h) => (
              <div key={h} className="hour-line" style={{ top: (h - firstHour) * HOUR_PX }} />
            ))}
            {lane === 0 &&
              blocks.map((b) => {
                const top = y(b.start)
                const h = Math.max(2, y(b.end) - top)
                const app = appById.get(b.appId)
                const cat = categoryById.get(b.categoryId)
                const color = cat?.color ?? '#8b949e'
                const tip = [
                  `${formatHM(b.start)}–${formatHM(b.end)} · ${app?.displayName ?? '?'} · ${duration(b.activeMs)}`,
                  categoryName(cat, t),
                  ...b.titles.map((x) => `${x.title} — ${duration(x.ms)}`)
                ].join('\n')
                return (
                  <div
                    key={`${b.appId}-${b.start}`}
                    className="tl-block"
                    title={tip}
                    style={{ top, height: h, borderColor: color, background: `color-mix(in srgb, ${color} 16%, var(--bgColor-default))` }}
                  >
                    {h >= 18 && (
                      <>
                        <AppIcon icon={app?.icon} name={app?.displayName ?? '?'} size={14} color={color} />
                        <span className="truncate grow">{app?.displayName}</span>
                        {h >= 18 && <span className="muted nowrap">{duration(b.activeMs)}</span>}
                      </>
                    )}
                  </div>
                )
              })}
            {lane === 1 &&
              entries.map((e) => {
                const end = e.end ?? now
                const top = y(e.start)
                const h = Math.max(2, y(end) - top)
                const color = e.end == null ? 'var(--fgColor-danger)' : 'var(--fgColor-accent)'
                return (
                  <div
                    key={e.id}
                    className="tl-block"
                    title={`${formatHM(e.start)}–${formatHM(end)} · #${e.taskNumber} ${e.taskTitle} · ${duration(end - e.start)}`}
                    style={{ top, height: h, borderColor: color, background: `color-mix(in srgb, ${color} 14%, var(--bgColor-default))` }}
                  >
                    {h >= 18 && (
                      <>
                        <span className="truncate grow">
                          #{e.taskNumber} {e.taskTitle}
                        </span>
                        <span className="muted nowrap">{duration(end - e.start)}</span>
                      </>
                    )}
                  </div>
                )
              })}
          </div>
        ))}
        {isToday && now - from >= firstHour * HOUR && <div className="now-line" style={{ top: y(now) }} />}
      </div>
    </div>
  )
}
