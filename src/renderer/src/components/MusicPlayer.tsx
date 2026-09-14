import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { MusicTrack } from '@shared/types'
import { api } from '../api'
import { useI18n } from '../i18n'
import { Cover } from './common'

type Repeat = 'off' | 'all' | 'one'

export interface Player {
  queue: MusicTrack[]
  index: number
  current: MusicTrack | null
  playing: boolean
  position: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: Repeat
  playList(list: MusicTrack[], start?: number): void
  toggle(): void
  next(): void
  prev(): void
  seek(sec: number): void
  setVolume(v: number): void
  toggleShuffle(): void
  cycleRepeat(): void
}

const PlayerContext = createContext<Player | null>(null)

export function usePlayer(): Player {
  const p = useContext(PlayerContext)
  if (!p) throw new Error('usePlayer() used outside <MusicPlayerProvider>')
  return p
}

const VOLUME_KEY = 'timehub.player.volume'
function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    const v = Number(raw)
    return raw != null && v >= 0 && v <= 1 ? v : 0.8
  } catch {
    return 0.8
  }
}

/** One audio element for the whole app, so music keeps playing on every tab. */
export function MusicPlayerProvider({ children }: { children: ReactNode }): ReactNode {
  const audio = useMemo(() => new Audio(), [])
  const [queue, setQueue] = useState<MusicTrack[]>([])
  const [index, setIndex] = useState(-1)
  const [token, setToken] = useState(0) // bumps to (re)start the current track
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(readVolume)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<Repeat>('off')
  const current = index >= 0 ? (queue[index] ?? null) : null
  const state = useRef({ queue, index, shuffle, repeat })
  state.current = { queue, index, shuffle, repeat }

  // What was actually heard — for Activity → Music and the library.
  const listen = useRef<{ track: MusicTrack; start: number; ms: number; last: number | null } | null>(null)
  const tick = useCallback((): void => {
    const l = listen.current
    if (!l) return
    const now = performance.now()
    if (l.last != null) l.ms += Math.min(2000, now - l.last)
    l.last = audio.paused ? null : now
  }, [audio])
  const flush = useCallback((): void => {
    tick()
    const l = listen.current
    listen.current = null
    if (l && l.ms >= 5000) {
      void api.logPlayback({ title: l.track.title, artist: l.track.artist, album: l.track.album, start: l.start, end: l.start + Math.round(l.ms) }).catch(() => {})
    }
  }, [tick])

  const go = useCallback((i: number): void => {
    setIndex(i)
    setToken((n) => n + 1)
  }, [])

  const advance = useCallback(
    (auto: boolean): void => {
      const { queue: q, index: i, shuffle: sh, repeat: rp } = state.current
      if (!q.length) return
      if (auto && rp === 'one') {
        go(i)
        return
      }
      let next = sh && q.length > 1 ? (i + 1 + Math.floor(Math.random() * (q.length - 1))) % q.length : i + 1
      if (next >= q.length) {
        if (rp !== 'all') {
          audio.pause()
          flush()
          return
        }
        next = 0
      }
      go(next)
    },
    [audio, flush, go]
  )

  const prev = useCallback((): void => {
    if (audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const { queue: q, index: i, repeat: rp } = state.current
    if (!q.length) return
    go(i > 0 ? i - 1 : rp === 'all' ? q.length - 1 : 0)
  }, [audio, go])

  useEffect(() => {
    if (!current) {
      audio.pause()
      return
    }
    flush()
    listen.current = { track: current, start: Date.now(), ms: 0, last: null }
    audio.src = current.url
    setPosition(0)
    setDuration(0)
    void audio.play().catch(() => setPlaying(false))
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album,
        artwork: current.cover ? [{ src: current.cover, sizes: '512x512' }] : []
      })
    }
    // Only a new track (token) restarts playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    const onTime = (): void => {
      setPosition(audio.currentTime)
      tick()
    }
    const onPlay = (): void => {
      setPlaying(true)
      if (listen.current) listen.current.last = performance.now()
    }
    const onPause = (): void => {
      tick()
      setPlaying(false)
    }
    const onMeta = (): void => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const onEnded = (): void => {
      tick()
      advance(true)
    }
    const onUnload = (): void => flush()
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnded)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnded)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [audio, advance, flush, tick])

  useEffect(() => {
    audio.volume = volume
    try {
      localStorage.setItem(VOLUME_KEY, String(volume))
    } catch {
      // not persisted
    }
  }, [audio, volume])

  // Keyboard media keys and the Windows volume flyout control this player too.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => void audio.play())
    ms.setActionHandler('pause', () => audio.pause())
    ms.setActionHandler('nexttrack', () => advance(false))
    ms.setActionHandler('previoustrack', prev)
    return () => {
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) ms.setActionHandler(a, null)
    }
  }, [audio, advance, prev])

  const value: Player = {
    queue,
    index,
    current,
    playing,
    position,
    duration,
    volume,
    shuffle,
    repeat,
    playList: (list, start = 0) => {
      if (!list.length) return
      setQueue(list)
      go(Math.min(Math.max(0, start), list.length - 1))
    },
    toggle: () => {
      if (!current) return
      if (audio.paused) void audio.play()
      else audio.pause()
    },
    next: () => advance(false),
    prev,
    seek: (sec) => {
      if (Number.isFinite(sec)) audio.currentTime = sec
    },
    setVolume: (v) => setVolumeState(Math.min(1, Math.max(0, v))),
    toggleShuffle: () => setShuffle((s) => !s),
    cycleRepeat: () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
  }
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export const ICONS = {
  play: 'M4.5 2.5v11l9-5.5z',
  pause: 'M4 2.5h3v11H4zm5 0h3v11H9z',
  prev: 'M3 2.5h2v11H3zm10.5 0v11L6 8z',
  next: 'M11 2.5h2v11h-2zm-8.5 0v11L10 8z',
  shuffle: 'M11 1.5l3 2.5-3 2.5V5H9.8L5 11H2V9.5h2.3L9.1 3.5H11zM2 4.5h3l1.3 1.6-.95 1.2L4.3 6H2zm7.8 5.5L11 11v-1l3 2.5-3 2.5V13.5H9.1L7.5 11.5l.95-1.2z',
  repeat: 'M3 5.5A1.5 1.5 0 014.5 4H11V2l3 3-3 3V6H4.5v2.5H3zm10 5A1.5 1.5 0 0111.5 12H5v2l-3-3 3-3v2h6.5V7.5H13z'
}

export function PlayerButton({
  d,
  label,
  onClick,
  primary,
  on,
  badge
}: {
  d: string
  label: string
  onClick(): void
  primary?: boolean
  on?: boolean
  badge?: string
}): ReactNode {
  return (
    <button type="button" className={`player-btn${primary ? ' primary' : ''}${on ? ' on' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <svg width={primary ? 16 : 14} height={primary ? 16 : 14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d={d} />
      </svg>
      {badge && <span className="badge">{badge}</span>}
    </button>
  )
}

const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The mini player along the bottom of the window. */
export function PlayerBar(): ReactNode {
  const p = usePlayer()
  const { t } = useI18n()
  const c = p.current
  if (!c) return null
  return (
    <div className="player-bar">
      <Cover src={c.cover} title={c.album || c.title} width={40} height={40} />
      <div className="player-meta">
        <div className="bold truncate" title={c.title}>
          {c.title}
        </div>
        <div className="small muted truncate">
          {c.artist || t('music.unknownArtist')}
          {c.album ? ` — ${c.album}` : ''}
        </div>
      </div>
      <div className="player-controls">
        <PlayerButton d={ICONS.shuffle} label={t('music.shuffle')} on={p.shuffle} onClick={p.toggleShuffle} />
        <PlayerButton d={ICONS.prev} label={t('music.prev')} onClick={p.prev} />
        <PlayerButton d={p.playing ? ICONS.pause : ICONS.play} label={p.playing ? t('music.pause') : t('music.play')} primary onClick={p.toggle} />
        <PlayerButton d={ICONS.next} label={t('music.next')} onClick={p.next} />
        <PlayerButton d={ICONS.repeat} label={t('music.repeat')} on={p.repeat !== 'off'} badge={p.repeat === 'one' ? '1' : undefined} onClick={p.cycleRepeat} />
      </div>
      <div className="player-seek">
        <span className="mono small muted">{clock(p.position)}</span>
        <input
          type="range"
          className="range grow"
          min={0}
          max={Math.max(1, Math.floor(p.duration))}
          step={1}
          value={Math.floor(p.position)}
          aria-label={t('music.seek')}
          onChange={(e) => p.seek(Number(e.target.value))}
        />
        <span className="mono small muted">{clock(p.duration)}</span>
      </div>
      <input
        type="range"
        className="range player-volume"
        min={0}
        max={1}
        step={0.01}
        value={p.volume}
        aria-label={t('music.volume')}
        onChange={(e) => p.setVolume(Number(e.target.value))}
      />
      <Link to="/music" className="small">
        {t('nav.music')}
      </Link>
    </div>
  )
}
