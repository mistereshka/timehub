import type { ReactNode } from 'react'
import type { HeatCell, Heatmap as HeatmapData } from '@shared/heatmap'
import type { HeatmapMetric } from '@shared/types'
import { useI18n } from '../i18n'
import { weekdayName } from '../utils'

const CELL = 10
const GAP = 3
const LEFT = 30
const TOP = 18

/** GitHub's contribution graph. */
export function Heatmap({
  heatmap,
  metric,
  weekStartsOn,
  onSelect
}: {
  heatmap: HeatmapData
  metric: HeatmapMetric
  weekStartsOn: 0 | 1
  onSelect?(date: string): void
}): ReactNode {
  const i18n = useI18n()
  const { t, tn, date, duration } = i18n
  const step = CELL + GAP
  const width = LEFT + heatmap.weeks.length * step
  const height = TOP + 7 * step

  // Skip a month label that would collide with the next one (GitHub does the same).
  const months = heatmap.months.filter((m, i, all) => i === all.length - 1 || all[i + 1].col - m.col >= 3)
  // Weekday labels on rows for Mon, Wed, Fri
  const rowOf = (mondayBasedIndex: number): number => (weekStartsOn === 1 ? mondayBasedIndex : (mondayBasedIndex + 1) % 7)
  const dayRows = [0, 2, 4].map((i) => ({ row: rowOf(i), label: weekdayName(i, i18n, 'EEEEEE') }))

  const describe = (c: HeatCell): string => {
    const day = date(c.date, 'd MMMM')
    if (metric === 'tasks') return tn('heatmap.tipTasks', c.value, { date: day })
    return c.value > 0 ? t('heatmap.tipActive', { time: duration(c.value), date: day }) : t('heatmap.tipNone', { date: day })
  }

  return (
    <div className="heatmap-scroll">
      <svg className="heatmap-svg" width={width} height={height} role="img" aria-label={t('heatmap.aria')}>
        {months.map((m) => (
          <text key={`${m.year}-${m.month}`} x={LEFT + m.col * step} y={10}>
            {date(new Date(m.year, m.month, 1), 'LLL')}
          </text>
        ))}
        {dayRows.map((d) => (
          <text key={d.row} x={0} y={TOP + d.row * step + 9}>
            {d.label}
          </text>
        ))}
        {heatmap.weeks.map((week, w) =>
          week.map((cell, d) =>
            cell ? (
              <rect
                key={cell.date}
                x={LEFT + w * step}
                y={TOP + d * step}
                width={CELL}
                height={CELL}
                rx={2}
                className={`heat-${cell.level}`}
                onClick={onSelect ? () => onSelect(cell.date) : undefined}
                style={onSelect ? { cursor: 'pointer' } : undefined}
              >
                <title>{describe(cell)}</title>
              </rect>
            ) : null
          )
        )}
      </svg>
    </div>
  )
}

export function HeatLegend(): ReactNode {
  const { t } = useI18n()
  return (
    <span className="heat-legend">
      {t('heatmap.less')}
      <svg width={5 * (CELL + GAP)} height={CELL}>
        {[0, 1, 2, 3, 4].map((l) => (
          <rect key={l} x={l * (CELL + GAP)} y={0} width={CELL} height={CELL} rx={2} className={`heat-${l}`} />
        ))}
      </svg>
      {t('heatmap.more')}
    </span>
  )
}
