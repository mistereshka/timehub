import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { DayValue } from '@shared/types'
import { HOUR, todayKey } from '@shared/time'
import { useI18n } from '../i18n'

/** Bar per day of active time; each bar links to that day's schedule. */
export function DayBars({ days }: { days: DayValue[] }): ReactNode {
  const { duration, date } = useI18n()
  const today = todayKey()
  const max = Math.max(HOUR, ...days.map((d) => d.value))
  const many = days.length > 10
  return (
    <div className={`bar-chart${many ? ' many' : ''}`}>
      {days.map((d) => (
        <Link
          key={d.date}
          to={`/schedule/${d.date}`}
          className={`bar-col link-plain${d.date === today ? ' today' : ''}`}
          title={`${date(d.date, 'EEEE, d MMMM')}: ${duration(d.value)}`}
        >
          {!many && <span>{d.value > 0 ? duration(d.value) : ''}</span>}
          <div className="bar" style={{ height: `${(d.value / max) * (many ? 85 : 72)}%` }} />
          <span>{many ? date(d.date, 'd') : date(d.date, 'EEEEEE')}</span>
        </Link>
      ))}
    </div>
  )
}
