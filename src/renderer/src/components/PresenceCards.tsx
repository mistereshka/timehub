import type { ReactNode } from 'react'
import { Button } from '@primer/react'
import { ClockIcon, FlameIcon, GraphIcon, LinkExternalIcon, PeopleIcon, RocketIcon, UnmuteIcon } from '@primer/octicons-react'
import { useNavigate } from 'react-router'
import type { GamePresence, MediaPresence } from '@shared/types'
import { formatClock } from '@shared/time'
import { api } from '../api'
import { useNow } from '../hooks'
import { useI18n } from '../i18n'
import { AppIcon, MiniProgress } from './common'
import { useApp } from '../context'
import { ICONS, PlayerButton } from './MusicPlayer'
import { PulseArt, Spectrum } from './Visualizer'

/** "Playing a game" card, like the one in a Discord profile. */
export function GameCard({ game }: { game: GamePresence }): ReactNode {
  const { t, tn, duration } = useI18n()
  const now = useNow(1000)
  const navigate = useNavigate()
  return (
    <div className="presence-card">
      <div className="presence-kicker">{t('presence.playing')}</div>
      {game.imageUrl && <img className="presence-banner" src={game.imageUrl} alt="" draggable={false} />}
      <div className="presence-main">
        <AppIcon icon={game.icon} name={game.displayName} size={48} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="presence-title truncate">{game.displayName}</div>
          {game.details && <div className="presence-line truncate">{game.details}</div>}
          <div className="presence-line mono">{t('presence.elapsed', { time: formatClock(now - game.since) })}</div>
        </div>
      </div>
      <div className="presence-stats">
        {game.playersOnline != null && (
          <div>
            <PeopleIcon size={14} /> {tn('presence.players', game.playersOnline)}
          </div>
        )}
        {game.streak > 0 && (
          <div className="streak-line">
            <FlameIcon size={14} /> {tn('presence.streak', game.streak)}
          </div>
        )}
        <div>
          <ClockIcon size={14} /> {t('presence.totals', { total: duration(game.totalMs), today: duration(game.todayMs) })}
        </div>
        {game.platformPlaytimeMin != null && game.platformPlaytimeMin > 0 && (
          <div>
            <RocketIcon size={14} /> {t('presence.steamHours', { n: Math.round(game.platformPlaytimeMin / 60) })}
          </div>
        )}
      </div>
      <div className="presence-actions">
        {game.storeUrl && (
          <Button size="small" leadingVisual={LinkExternalIcon} onClick={() => void api.openExternal(game.storeUrl!)}>
            {t(game.provider === 'roblox' ? 'presence.openRoblox' : 'presence.openStore')}
          </Button>
        )}
        <Button size="small" leadingVisual={GraphIcon} onClick={() => navigate(`/activity/apps/${game.appId}`)}>
          {t('presence.report')}
        </Button>
      </div>
    </div>
  )
}

/** "Listening to Spotify" card with the track position. */
export function MusicCard({ media }: { media: MediaPresence }): ReactNode {
  const { t } = useI18n()
  const { settings } = useApp()
  const now = useNow(1000)
  const vis = settings.visualizer && media.playing
  const control = (action: 'toggle' | 'next' | 'previous'): void => void api.mediaControl(action).catch(() => {})
  const position =
    media.positionMs != null
      ? Math.min(media.durationMs ?? Number.MAX_SAFE_INTEGER, media.positionMs + (media.playing ? now - media.updatedAt : 0))
      : null
  return (
    <div className="presence-card">
      <div className="presence-kicker">{t(media.kind === 'video' ? 'presence.watching' : 'presence.listening', { app: media.sourceName })}</div>
      <div className="presence-main">
        <PulseArt active={vis}>
          {media.thumbnail ? (
            <img className="presence-art" src={media.thumbnail} alt="" draggable={false} />
          ) : (
            <span className="presence-art presence-art-empty">
              <UnmuteIcon size={20} />
            </span>
          )}
        </PulseArt>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="presence-title truncate" title={media.title}>
            {media.title}
          </div>
          {media.artist && <div className="presence-line truncate">{media.artist}</div>}
          {media.album && <div className="presence-line muted truncate">{media.album}</div>}
        </div>
      </div>
      {media.durationMs != null && position != null && (
        <div className="presence-progress">
          <span className="mono small">{formatClock(position)}</span>
          <MiniProgress value={position / media.durationMs} />
          <span className="mono small">{formatClock(media.durationMs)}</span>
        </div>
      )}
      {settings.visualizer && <Spectrum active={vis} bars={40} className="presence-spectrum" />}
      <div className="presence-controls">
        <PlayerButton d={ICONS.prev} label={t('music.prev')} onClick={() => control('previous')} />
        <PlayerButton
          d={media.playing ? ICONS.pause : ICONS.play}
          label={media.playing ? t('music.pause') : t('music.play')}
          primary
          onClick={() => control('toggle')}
        />
        <PlayerButton d={ICONS.next} label={t('music.next')} onClick={() => control('next')} />
      </div>
      {!media.playing && <div className="small muted">{t('presence.paused')}</div>}
    </div>
  )
}
