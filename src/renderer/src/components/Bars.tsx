import type { ReactNode } from 'react'
import { Link } from 'react-router'

export interface Bar {
  key: string
  label: string
  value: number
  title?: string
  highlight?: boolean
  to?: string
}

/** Simple vertical bar chart (months, hours of day, weekdays…). */
export function Bars({ items, height = 120, format }: { items: Bar[]; height?: number; format?(value: number): string }): ReactNode {
  const max = Math.max(1, ...items.map((i) => i.value))
  const dense = items.length > 14
  return (
    <div className={`bar-chart${dense ? ' many' : ''}`} style={{ height }}>
      {items.map((i) => {
        const body = (
          <>
            {!dense && format && <span>{i.value > 0 ? format(i.value) : ''}</span>}
            <div className="bar" style={{ height: `${(i.value / max) * (dense ? 85 : 72)}%` }} />
            <span>{i.label}</span>
          </>
        )
        const cls = `bar-col${i.highlight ? ' today' : ''}`
        const title = i.title ?? (format ? `${i.label}: ${format(i.value)}` : undefined)
        return i.to ? (
          <Link key={i.key} to={i.to} className={`${cls} link-plain`} title={title}>
            {body}
          </Link>
        ) : (
          <div key={i.key} className={cls} title={title}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
