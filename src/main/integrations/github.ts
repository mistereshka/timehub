import type { DayValue } from '@shared/types'
import { dayKey } from '@shared/time'
import type { Connector, Env } from './connections'
import { getJson } from './http'

const CALENDAR_QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`

interface PublicEvent {
  type: string
  created_at: string
  payload?: { size?: number; distinct_size?: number }
}

/** GitHub: your contributions on the overview heatmap and in the feed. */
export class GitHubConnector implements Connector {
  readonly key = 'github' as const
  readonly defaultEnabled = false
  readonly syncEveryMs = 60 * 60_000

  async sync(env: Env): Promise<void> {
    const login = env.settings().username?.trim()
    const ru = env.language() === 'ru'
    if (!login) throw new Error(ru ? 'Укажите имя пользователя GitHub' : 'Enter your GitHub username')
    const token = env.secret('token')
    const headers: Record<string, string> = { 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const user = await getJson(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers })

    let days: DayValue[]
    let detail: string
    if (token) {
      const r = await getJson('https://api.github.com/graphql', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: CALENDAR_QUERY, variables: { login } })
      })
      const calendar = r?.data?.user?.contributionsCollection?.contributionCalendar
      if (!calendar) throw new Error(r?.errors?.[0]?.message ?? 'GitHub did not return a contribution calendar')
      days = calendar.weeks.flatMap((w: { contributionDays: { date: string; contributionCount: number }[] }) =>
        w.contributionDays.map((d) => ({ date: d.date, value: d.contributionCount }))
      )
      detail = ru ? `${calendar.totalContributions} вкладов за год` : `${calendar.totalContributions} contributions in the last year`
    } else {
      // Without a token only public events of the last ~90 days are available.
      const counts = new Map<string, number>()
      let total = 0
      for (let page = 1; page <= 3; page++) {
        const events = (await getJson(`https://api.github.com/users/${encodeURIComponent(login)}/events/public?per_page=100&page=${page}`, {
          headers
        })) as PublicEvent[]
        for (const e of events) {
          const n = e.type === 'PushEvent' ? Math.max(1, e.payload?.distinct_size ?? e.payload?.size ?? 1) : 1
          const key = dayKey(Date.parse(e.created_at))
          counts.set(key, (counts.get(key) ?? 0) + n)
          total += n
        }
        if (events.length < 100) break
      }
      days = [...counts].map(([date, value]) => ({ date, value }))
      detail = ru ? `${total} публичных действий за 90 дней` : `${total} public events in 90 days`
    }
    env.service.setExternalDays('github', days)
    env.setState({ connected: true, account: user?.name || user?.login || login, avatar: user?.avatar_url ?? null, detail })
  }
}
