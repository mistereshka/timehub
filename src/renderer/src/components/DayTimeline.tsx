import type { ReactNode } from 'react'
import type { ActivitySession, TimeEntry } from '@shared/types'
import { DAY, HOUR, MINUTE, formatHM, pad2, startOfDayMs, todayKey } from '@shared/time'
import { buildAgenda, groupShortBlocks } from '@shared/schedule'
import { useApp } from '../context'
import { useNow } from '../hooks'
import { useI18n } from '../i18n'
import { categoryName } from '../utils'
import { AppIcon } from './common'

const HOUR_PX = 56
/** A block needs this much height to show its icon and name. */
const LABEL_PX = 18
/** Short app switches are grouped until they are tall enough for a label (~20 min). */
const GROUP_MS = Math.ceil((LABEL_PX / HOUR_PX) * 60) * MINUTE

/** Something planned for the day: a calendar event or a task with a start time. */
export interface PlanBlock {
  key: string
  title: string
  start: number
  end: number
  color: string
  kind: 'event' | 'task'
}

/** Vertical day view: app activity, tracked time and the plan (calendar + timed tasks). */
export function DayTimeline({
  day,
  sessions,
  entries,
  plan = []
}: {
  day: string
  sessions: ActivitySession[]
  entries: TimeEntry[]
  plan?: PlanBlock[]
}): ReactNode {
  const { appById, categoryById } = useApp()
  const { t, duration } = useI18n()
  const now = useNow(30_000)
  const from = startOfDayMs(day)
  const isToday = day === todayKey(now)

  const spans = [
    ...sessions.map((s) => [s.start, s.end]),
    ...entries.map((e) => [e.start, e.end ?? now]),
    ...plan.map((p) => [p.start, p.end])
  ].flat()
  const minH = spans.length ? Math.floor((Math.max(from, Math.min(...spans)) - from) / HOUR) : 8
  const maxH = spans.length ? Math.ceil((Math.min(from + DAY, Math.max(...spans)) - from) / HOUR) : 20
  const firstHour = Math.max(0, Math.min(8, minH))
  const lastHour = Math.min(24, Math.max(20, maxH, isToday ? Math.ceil((now - from) / HOUR) : 0))
  const y = (ts: number): number => ((Math.max(from, ts) - from) / HOUR - firstHour) * HOUR_PX
  const height = (lastHour - firstHour) * HOUR_PX
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i)

  const blocks = groupShortBlocks(buildAgenda(sessions, { from, to: from + DAY, noiseMs: 0, mergeGapMs: MINUTE, minBlockMs: 0 }), GROUP_MS)
  const block = (key: string, start: number, end: number, color: string, tip: string, body: ReactNode, dashed = false): ReactNode => {
    const top = y(start)
    const h = Math.max(2, y(end) - top)
    return (
      <div
        key={key}
        className={`tl-block${dashed ? ' tl-plan' : ''}`}
        title={tip}
        style={{ top, height: h, borderColor: color, background: dashed ? undefined : `color-mix(in srgb, ${color} 16%, var(--bgColor-default))` }}
      >
        {h >= LABEL_PX && body}
      </div>
    )
  }

  return (
    <div className="tl-wrap">
      <div className="tl-head">
        <div className="lane-title" />
        <div className="lane-title">{t('schedule.laneApps')}</div>
        <div className="lane-title">{t('schedule.laneTasks')}</div>
        <div className="lane-title">{t('schedule.lanePlan')}</div>
      </div>
      <div className="day-timeline" style={{ height: height + 12 }}>
        <div className="hours">
          {hours.map((h) => (
            <span key={h} className="hour-label" style={{ top: (h - firstHour) * HOUR_PX }}>
              {pad2(h % 24)}:00
            </span>
          ))}
        </div>
        {[0, 1, 2].map((lane) => (
          <div key={lane} className="lane">
            {hours.map((h) => (
              <div key={h} className="hour-line" style={{ top: (h - firstHour) * HOUR_PX }} />
            ))}
            {lane === 0 &&
              blocks.map((b) => {
                const app = appById.get(b.appId)
                const cat = categoryById.get(b.categoryId)
                const color = cat?.color ?? '#8b949e'
                const name = app?.displayName ?? '?'
                const others = b.apps.length - 1
                const tip = [
                  others > 0
                    ? `${formatHM(b.start)}–${formatHM(b.end)} · ${duration(b.activeMs)}`
                    : `${formatHM(b.start)}–${formatHM(b.end)} · ${name} · ${duration(b.activeMs)}`,
                  ...(others > 0
                    ? b.apps.map((a) => `${appById.get(a.appId)?.displayName ?? '?'} — ${duration(a.ms)}`)
                    : [categoryName(cat, t), ...b.titles.map((x) => `${x.title} — ${duration(x.ms)}`)])
                ].join('\n')
                return block(
                  `${b.appId}-${b.start}`,
                  b.start,
                  b.end,
                  color,
                  tip,
                  <>
                    <AppIcon icon={app?.icon} name={name} size={14} color={color} />
                    <span className="truncate grow">
                      {name}
                      {others > 0 && <span className="muted"> +{others}</span>}
                    </span>
                    <span className="muted nowrap">{duration(b.activeMs)}</span>
                  </>
                )
              })}
            {lane === 1 &&
              entries.map((e) => {
                const end = e.end ?? now
                const color = e.end == null ? 'var(--fgColor-danger)' : e.goalId != null ? 'var(--fgColor-done)' : 'var(--fgColor-accent)'
                const label = e.taskNumber != null ? `#${e.taskNumber} ${e.title}` : `🎯 ${e.title}`
                return block(
                  `e${e.id}`,
                  e.start,
                  end,
                  color,
                  `${formatHM(e.start)}–${formatHM(end)} · ${label} · ${duration(end - e.start)}`,
                  <>
                    <span className="truncate grow">{label}</span>
                    <span className="muted nowrap">{duration(end - e.start)}</span>
                  </>
                )
              })}
            {lane === 2 &&
              plan.map((p) =>
                block(
                  p.key,
                  p.start,
                  p.end,
                  p.color,
                  `${formatHM(p.start)}–${formatHM(p.end)} · ${p.title}`,
                  <>
                    <span className="truncate grow">{p.title}</span>
                    <span className="muted nowrap">{formatHM(p.start)}</span>
                  </>,
                  true
                )
              )}
          </div>
        ))}
        {isToday && now - from >= firstHour * HOUR && <div className="now-line" style={{ top: y(now) }} />}
      </div>
    </div>
  )
}
