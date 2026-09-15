import { useState, type ReactNode } from 'react'
import { Button, Flash, IconButton, Spinner, TextInput } from '@primer/react'
import { FileDirectoryIcon, SearchIcon, SyncIcon, UnmuteIcon, XIcon } from '@primer/octicons-react'
import { Link } from 'react-router'
import type { MediaAction } from '@shared/types'
import { DAY } from '@shared/time'
import { api } from '../api'
import { useApp } from '../context'
import { useAction, useQuery } from '../hooks'
import { useI18n } from '../i18n'
import { Blankslate, Cover, ErrorFlash } from '../components/common'
import { ICONS, PlayerButton, usePlayer } from '../components/MusicPlayer'
import { RadialVisualizer } from '../components/Visualizer'

const LIMIT = 500

function shuffled<T>(list: T[]): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** What plays right now — timehub's own player or anything in Windows — with the big visual and controls. */
function NowPlaying({ onControl }: { onControl(action: MediaAction): void }): ReactNode {
  const { t } = useI18n()
  const { tracker, settings } = useApp()
  const player = usePlayer()
  const own = player.current
  const media = tracker.media
  const item =
    own && (player.playing || !media?.playing)
      ? { title: own.title, artist: own.artist || t('music.unknownArtist'), cover: own.cover, source: 'timehub', playing: player.playing, own: true }
      : media
        ? { title: media.title, artist: media.artist, cover: media.thumbnail, source: media.sourceName, playing: media.playing, own: false }
        : null
  if (!item) {
    return <div className="box box-body mb-3 small muted">{t('music.remoteEmpty')}</div>
  }
  const act = (action: MediaAction): void => {
    if (!item.own) onControl(action)
    else if (action === 'toggle') player.toggle()
    else if (action === 'next') player.next()
    else player.prev()
  }
  return (
    <section className="box now-playing mb-3">
      {settings.visualizer ? (
        <RadialVisualizer active={item.playing} cover={item.cover} title={item.title} size={210} />
      ) : (
        <Cover src={item.cover} title={item.title} width={128} height={128} />
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="presence-kicker">
          {t('music.nowPlayingTitle')} · {item.source}
        </div>
        <div className="now-playing-title truncate" title={item.title}>
          {item.title}
        </div>
        <div className="muted truncate">{item.artist}</div>
        <div className="player-controls mt-3">
          <PlayerButton d={ICONS.prev} label={t('music.prev')} onClick={() => act('previous')} />
          <PlayerButton d={item.playing ? ICONS.pause : ICONS.play} label={item.playing ? t('music.pause') : t('music.play')} primary onClick={() => act('toggle')} />
          <PlayerButton d={ICONS.next} label={t('music.next')} onClick={() => act('next')} />
        </div>
      </div>
    </section>
  )
}

/** Your own music files, a remote for Yandex Music / Spotify / YouTube, and what you listened to. */
export function MusicPage(): ReactNode {
  const { t, tn, duration } = useI18n()
  const { meta } = useApp()
  const player = usePlayer()
  const [rescan, setRescan] = useState(0)
  const lib = useQuery(() => api.scanMusic(rescan > 0), [rescan])
  const week = useQuery(() => api.getMusic(Date.now() - 7 * DAY, Date.now()), [], ['music'])
  const [filter, setFilter] = useState('')
  const addFolder = useAction(async () => {
    await api.addMusicFolder()
    setRescan((n) => n + 1)
  })
  const removeFolder = useAction(async (folder: string) => {
    await api.updateSettings({ musicFolders: (lib.data?.folders ?? []).filter((f) => f !== folder) })
    setRescan((n) => n + 1)
  })
  const control = useAction((action: MediaAction) => api.mediaControl(action))

  const tracks = lib.data?.tracks ?? []
  const folders = lib.data?.folders ?? []
  const needle = filter.trim().toLowerCase()
  const shown = needle ? tracks.filter((x) => `${x.title} ${x.artist} ${x.album}`.toLowerCase().includes(needle)) : tracks

  return (
    <div className="container">
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">{t('music.title')}</h1>
          <div className="muted">{t('music.subtitle')}</div>
        </div>
        <Button leadingVisual={SyncIcon} disabled={lib.loading} onClick={() => setRescan((n) => n + 1)}>
          {t('music.rescan')}
        </Button>
        <Button leadingVisual={FileDirectoryIcon} disabled={addFolder.busy} onClick={() => void addFolder.run()}>
          {t('music.addFolder')}
        </Button>
        <Button variant="primary" disabled={!shown.length} onClick={() => player.playList(shuffled(shown))}>
          {t('music.shuffleAll')}
        </Button>
      </div>
      {meta.demo && <Flash className="mb-3">{t('music.demo')}</Flash>}
      <ErrorFlash error={addFolder.error ?? removeFolder.error ?? control.error} />
      <NowPlaying onControl={(action) => void control.run(action)} />

      <div className="layout-sidebar">
        <div className="stack">
          <TextInput block leadingVisual={SearchIcon} placeholder={t('music.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="box">
            <div className="box-header">
              <h2 className="box-title grow">{tn('music.tracks', shown.length)}</h2>
            </div>
            {lib.loading && !lib.data ? (
              <div className="box-body small muted row">
                <Spinner size="small" /> {t('music.scanning')}
              </div>
            ) : tracks.length === 0 ? (
              <Blankslate icon={<UnmuteIcon size={24} />} title={t('music.emptyTitle')}>
                <p>{t('music.emptyText')}</p>
                <Button variant="primary" onClick={() => void addFolder.run()}>
                  {t('music.addFolder')}
                </Button>
              </Blankslate>
            ) : (
              shown.slice(0, LIMIT).map((track, i) => {
                const active = player.current?.id === track.id
                return (
                  <button
                    key={track.id}
                    type="button"
                    className={`box-row hoverable music-track${active ? ' active' : ''}`}
                    onClick={() => (active ? player.toggle() : player.playList(shown, i))}
                  >
                    <Cover src={track.cover} title={track.album || track.title} width={36} height={36} />
                    <span className="grow music-track-main">
                      <span className="bold truncate">{track.title}</span>
                      <span className="small muted truncate">{track.artist || t('music.unknownArtist')}</span>
                    </span>
                    <span className="small muted truncate music-track-album">{track.album}</span>
                    {active && <span className="small fg-success nowrap">{player.playing ? t('music.nowPlaying') : t('music.paused')}</span>}
                  </button>
                )
              })
            )}
            {shown.length > LIMIT && <div className="box-footer small muted">{t('music.more', { n: LIMIT })}</div>}
          </div>
        </div>

        <aside className="stack">
          <section className="box">
            <div className="box-header">
              <h2 className="box-title">{t('music.folders')}</h2>
            </div>
            {folders.map((f) => (
              <div key={f} className="box-row small" style={{ alignItems: 'center' }}>
                <FileDirectoryIcon size={14} />
                <span className="grow truncate" title={f}>
                  {f}
                </span>
                {folders.length > 1 && (
                  <IconButton icon={XIcon} size="small" variant="invisible" aria-label={t('music.removeFolder')} onClick={() => void removeFolder.run(f)} />
                )}
              </div>
            ))}
            {!folders.length && <div className="box-body small muted">—</div>}
          </section>

          <section className="box">
            <div className="box-header">
              <h2 className="box-title grow">{t('music.week')}</h2>
              <Link className="small" to="/activity">
                {t('music.allStats')}
              </Link>
            </div>
            <div className="box-body stack stack-sm">
              {week.data && week.data.totalMs > 0 ? (
                <>
                  <div className="small muted">{t('activity.musicTotal', { time: duration(week.data.totalMs) })}</div>
                  {week.data.topArtists.slice(0, 6).map((a) => (
                    <div key={a.name} className="music-row">
                      <span className="grow truncate">{a.name}</span>
                      <span className="muted nowrap">{duration(a.ms)}</span>
                    </div>
                  ))}
                </>
              ) : (
                <p className="small muted m-0">{t('activity.noMusic')}</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
