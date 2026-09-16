import { useState, type ReactNode } from 'react'
import { SegmentedControl, Select, TextInput } from '@primer/react'
import { RocketIcon, SearchIcon } from '@primer/octicons-react'
import { useNavigate } from 'react-router'
import type { GamePlatform, InstalledGame } from '@shared/types'
import { MINUTE } from '@shared/time'
import { api } from '../api'
import { useAction, useQuery } from '../hooks'
import { useI18n, type MessageKey } from '../i18n'
import { Blankslate, Cover, ErrorFlash } from '../components/common'

type Filter = 'all' | GamePlatform
type Sort = 'recent' | 'played' | 'name'
const FILTERS: Filter[] = ['all', 'steam', 'epic', 'battlenet', 'minecraft', 'other']
const PLATFORM_NAME: Record<GamePlatform, string> = { steam: 'Steam', epic: 'Epic', battlenet: 'Battle.net', minecraft: 'Minecraft', other: '' }

const playedMs = (g: InstalledGame): number => Math.max(g.trackedMs, (g.platformMinutes ?? 0) * MINUTE)

/** Everything installed, one click to start. */
export function GamesPage(): ReactNode {
  const { t, tn, duration, ago } = useI18n()
  const navigate = useNavigate()
  const games = useQuery(() => api.listGames(), [], ['connections', 'meta'])
  const [platform, setPlatform] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [filter, setFilter] = useState('')
  const [launching, setLaunching] = useState<string | null>(null)
  const launch = useAction(async (id: string) => {
    setLaunching(id)
    setTimeout(() => setLaunching((x) => (x === id ? null : x)), 5000)
    await api.launchGame(id)
  })

  const all = games.data ?? []
  const count = (p: Filter): number => (p === 'all' ? all.length : all.filter((g) => g.platform === p).length)
  const needle = filter.trim().toLowerCase()
  const shown = all
    .filter((g) => (platform === 'all' || g.platform === platform) && (!needle || g.name.toLowerCase().includes(needle)))
    .sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'played' ? playedMs(b) - playedMs(a) : (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
    )
  const platformName = (p: GamePlatform): string => PLATFORM_NAME[p] || t('games.other')

  return (
    <div className="container container-wide">
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">{t('games.title')}</h1>
          <div className="muted">{t('games.subtitle')}</div>
        </div>
        <TextInput leadingVisual={SearchIcon} placeholder={t('games.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="row row-wrap mb-3">
        <SegmentedControl aria-label={t('games.platform')} size="small" onChange={(i) => setPlatform(FILTERS[i])}>
          {FILTERS.map((p) => (
            <SegmentedControl.Button key={p} selected={platform === p}>
              {`${p === 'all' ? t('games.all') : platformName(p)} ${count(p)}`}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
        <span className="grow" />
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('games.sortLabel')}>
          {(['recent', 'played', 'name'] as Sort[]).map((s) => (
            <Select.Option key={s} value={s}>
              {t(`games.sort.${s}` as MessageKey)}
            </Select.Option>
          ))}
        </Select>
      </div>
      <ErrorFlash error={launch.error} />

      {shown.length === 0 ? (
        !games.loading && (
          <div className="box">
            <Blankslate icon={<RocketIcon size={24} />} title={t('games.emptyTitle')}>
              <p>{t('games.emptyText')}</p>
            </Blankslate>
          </div>
        )
      ) : (
        <>
          <div className="small muted mb-2">{tn('games.count', shown.length)}</div>
          <div className="games-grid">
            {shown.map((g) => (
              <div key={g.id} className="game-tile">
                <button type="button" className="game-cover" onClick={() => void launch.run(g.id)} title={t('games.play')}>
                  <Cover src={g.cover} title={g.name} width="100%" height="100%" />
                  <span className="game-platform">{platformName(g.platform)}</span>
                  <span className={`game-play${launching === g.id ? ' busy' : ''}`}>{launching === g.id ? t('games.launching') : `▶ ${t('games.play')}`}</span>
                </button>
                <div className="game-name truncate" title={g.name}>
                  {g.name}
                </div>
                <div className="small muted">
                  {playedMs(g) === 0
                    ? t('games.never')
                    : g.trackedMs >= (g.platformMinutes ?? 0) * MINUTE
                      ? t('games.played', { time: duration(g.trackedMs) })
                      : t(g.platform === 'minecraft' ? 'games.prismHours' : 'games.steamHours', { n: Math.round((g.platformMinutes ?? 0) / 60) })}
                </div>
                {g.lastPlayed != null && <div className="small muted">{t('games.last', { ago: ago(g.lastPlayed) })}</div>}
                {g.appId != null && (
                  <button type="button" className="link-button small" onClick={() => navigate(`/activity/apps/${g.appId}`)}>
                    {t('games.report')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

