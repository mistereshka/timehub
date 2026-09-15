import { useState, type ReactNode } from 'react'
import { Button, Select, Spinner } from '@primer/react'
import { LinkExternalIcon } from '@primer/octicons-react'
import type { DotaStats } from '@shared/types'
import { rankIcons, rankName } from '@shared/dota'
import { api, errorMessage } from '../api'
import { useApp } from '../context'
import { useQuery } from '../hooks'
import { useI18n } from '../i18n'

const pct = (wins: number, games: number): number => (games ? Math.round((wins / games) * 1000) / 10 : 0)

/** Dotabuff-style Dota 2 block on the game's report page. */
export function DotaPanel(): ReactNode {
  const { t } = useI18n()
  const [account, setAccount] = useState<string | null>(null)
  // Refetch when Steam finishes syncing (its accounts are what we look up).
  const stats = useQuery(() => api.getDotaStats(account), [account], ['connections'])
  if (stats.error) {
    return <div className="box box-body mb-3 small fg-danger">{errorMessage(stats.error)}</div>
  }
  if (!stats.data) {
    return (
      <div className="box box-body mb-3 small muted row">
        {stats.loading ? (
          <>
            <Spinner size="small" /> {t('dota.loading')}
          </>
        ) : (
          t('dota.noMatches')
        )}
      </div>
    )
  }
  return <DotaView stats={stats.data} onAccount={setAccount} />
}

function DotaView({ stats: s, onAccount }: { stats: DotaStats; onAccount(id: string): void }): ReactNode {
  const { settings } = useApp()
  const { t, tn, ago, duration } = useI18n()
  const games = s.wins + s.losses
  const icons = rankIcons(s.rankTier)
  const rank = rankName(s.rankTier, settings.language) ?? t('dota.unranked')
  const openMatch = (id: string): void => void api.openExternal(`https://www.dotabuff.com/matches/${id}`)

  return (
    <section className="mb-3">
      <div className="box dota-head mb-3">
        {s.avatar && <img className="dota-avatar" src={s.avatar} alt="" draggable={false} />}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="presence-kicker">Dota 2</div>
          <div className="bold truncate">{s.name}</div>
          <div className="small muted">{tn('dota.matches', games)}</div>
        </div>
        {s.accounts.length > 1 && (
          <Select value={s.accountId} onChange={(e) => onAccount(e.target.value)} aria-label={t('dota.account')}>
            {s.accounts.map((a) => (
              <Select.Option key={a.accountId} value={a.accountId}>
                {`${a.name} · ${tn('dota.matches', a.matches)}`}
              </Select.Option>
            ))}
          </Select>
        )}
        <div className="dota-rank" title={rank}>
          {icons ? (
            <>
              <img src={icons.medal} alt="" draggable={false} />
              {icons.star && <img src={icons.star} alt="" draggable={false} />}
            </>
          ) : (
            <span className="muted small">—</span>
          )}
        </div>
        <div className="dota-stat">
          <span className="small muted">{t('dota.rank')}</span>
          <span className="v">{rank}</span>
          {s.leaderboardRank != null && <span className="small muted">#{s.leaderboardRank}</span>}
        </div>
        <div className="dota-stat">
          <span className="small muted">{t('dota.record')}</span>
          <span className="v">
            <span className="fg-win">{s.wins}</span> – <span className="fg-danger">{s.losses}</span>
          </span>
        </div>
        <div className="dota-stat">
          <span className="small muted">{t('dota.winrate')}</span>
          <span className="v">{pct(s.wins, games)}%</span>
          <span className="wr-bar">
            <span style={{ width: `${pct(s.wins, games)}%` }} />
          </span>
        </div>
        {s.avg && (
          <div className="dota-stat">
            <span className="small muted">{t('dota.avg')}</span>
            <span className="v mono">
              {s.avg.kills} / {s.avg.deaths} / {s.avg.assists}
            </span>
            <span className="small muted">
              GPM {s.avg.gpm} · XPM {s.avg.xpm}
            </span>
          </div>
        )}
        <Button size="small" leadingVisual={LinkExternalIcon} onClick={() => void api.openExternal(s.profileUrl)}>
          {t('dota.profile')}
        </Button>
      </div>

      <div className="schedule-grid">
        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('dota.recent')}</h2>
          </div>
          {s.recent.length === 0 && <div className="box-body small muted">{t('dota.noMatches')}</div>}
          {s.recent.map((m) => (
            <button key={m.matchId} type="button" className="box-row hoverable dota-match" onClick={() => openMatch(m.matchId)}>
              {m.heroImage ? <img className="dota-hero-img" src={m.heroImage} alt="" draggable={false} /> : <span className="dota-hero-img" />}
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="bold truncate">{m.hero}</span>
                <span className="small muted truncate">
                  {m.mode}
                  {m.ranked ? ` · ${t('dota.ranked')}` : ''} · {ago(m.startTime)}
                </span>
              </span>
              <span className={`dota-result ${m.win ? 'fg-win' : 'fg-danger'}`}>{m.win ? t('dota.win') : t('dota.loss')}</span>
              <span className="mono small nowrap dota-kda">
                {m.kills}/{m.deaths}/{m.assists}
              </span>
              <span className="small muted nowrap">{duration(m.durationSec * 1000)}</span>
            </button>
          ))}
        </section>
        <section className="box">
          <div className="box-header">
            <h2 className="box-title">{t('dota.heroes')}</h2>
          </div>
          {s.heroes.map((h) => (
            <div key={h.heroId} className="box-row dota-match">
              {h.heroImage ? <img className="dota-hero-img" src={h.heroImage} alt="" draggable={false} /> : <span className="dota-hero-img" />}
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="bold truncate">{h.hero}</span>
                <span className="small muted truncate">
                  {tn('dota.matches', h.games)}
                  {h.lastPlayed ? ` · ${ago(h.lastPlayed)}` : ''}
                </span>
              </span>
              <span className="wr-bar">
                <span style={{ width: `${pct(h.wins, h.games)}%` }} />
              </span>
              <span className="small nowrap dota-kda">{pct(h.wins, h.games)}%</span>
            </div>
          ))}
        </section>
      </div>
      <p className="small muted mt-2">{t('dota.source')}</p>
    </section>
  )
}
