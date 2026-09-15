import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mediaKind } from '@shared/media'
import type { MediaAction, MediaPresence } from '@shared/types'
import type { Connector, Env } from './connections'
import { itunesCover, itunesTrackCover } from './search'

// Polls Windows' Global System Media Transport Controls (what shows in the volume flyout)
// and prints one JSON line whenever the track or play state changes, plus a heartbeat.
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(5000) | Out-Null; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$last = ''; $lastTrack = ''; $lastApp = ''; $beat = [DateTime]::MinValue
while ($true) {
  try {
    # Not just the "current" session: Telegram or a paused tab can hold that spot while music plays
    # elsewhere. Prefer a playing session, and among those one with an album (music over videos).
    $s = $null; $bestScore = -1
    foreach ($c in @($mgr.GetSessions())) {
      if ($c.SourceAppUserModelId -like '*timehub*') { continue }
      if ([string]$c.GetPlaybackInfo().PlaybackStatus -ne 'Playing') { continue }
      $cp = Await ($c.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $score = 1 + [int][bool]$cp.AlbumTitle
      if ($score -gt $bestScore) { $s = $c; $bestScore = $score }
    }
    if ($null -ne $s) { $lastApp = $s.SourceAppUserModelId }
    # Nothing playing for a moment (buffering, seeking): stay with the last player instead of
    # jumping to a paused Telegram, which would cut the track into pieces.
    if ($null -eq $s -and $lastApp) { $s = @($mgr.GetSessions()) | Where-Object { $_.SourceAppUserModelId -eq $lastApp } | Select-Object -First 1 }
    if ($null -eq $s) { $s = $mgr.GetCurrentSession() }
    if ($null -eq $s) { $key = 'none'; $obj = @{ none = $true } }
    else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties()
      $st = [string]$s.GetPlaybackInfo().PlaybackStatus
      $track = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
      $key = "$track|$st"
      $obj = @{ app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; status = $st; position = [int64]$tl.Position.TotalMilliseconds; duration = [int64]$tl.EndTime.TotalMilliseconds; updated = [int64]$tl.LastUpdatedTime.ToUnixTimeMilliseconds() }
      if ($track -ne $lastTrack -and $p.Thumbnail) {
        try {
          $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
          $size = [uint32]$stream.Size
          if ($size -gt 0 -and $size -lt 400000) {
            $reader = [Windows.Storage.Streams.DataReader]::new($stream)
            Await ($reader.LoadAsync($size)) ([uint32]) | Out-Null
            $bytes = New-Object byte[] $size
            $reader.ReadBytes($bytes)
            $obj.thumb = [Convert]::ToBase64String($bytes)
          }
        } catch {}
      }
      $lastTrack = $track
    }
    $now = [DateTime]::UtcNow
    if ($key -ne $last -or ($now - $beat).TotalSeconds -ge 10) {
      [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
      $last = $key; $beat = $now
    }
  } catch {}
  Start-Sleep -Milliseconds 2000
}
`

const HEARTBEAT_MS = 10_000

// One-shot remote: play/pause, next or previous on another player's Windows media session.
const CONTROL_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(5000) | Out-Null; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$sessions = @($mgr.GetSessions()) | Where-Object { $_.SourceAppUserModelId -notlike '*timehub*' }
$s = $sessions | Where-Object { $_.SourceAppUserModelId -eq $prefer } | Select-Object -First 1
if (-not $s) { $s = $sessions | Where-Object { [string]$_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1 }
if (-not $s) { $s = $sessions | Select-Object -First 1 }
if ($s) {
  switch ($action) {
    'toggle' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
    'next' { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }
    'previous' { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }
  }
}
`

export function controlMedia(action: MediaAction, prefer: string): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const script = `$action = ${quote(action)}; $prefer = ${quote(prefer)}\n${CONTROL_SCRIPT}`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    p.on('exit', () => resolve())
    p.on('error', () => resolve())
  })
}

/** "Spotify.exe" → "Spotify", "308046B0AF4A39CB" (Firefox) → "Firefox"… */
export function mediaSourceName(aumid: string): string {
  const id = aumid.toLowerCase()
  const known: [RegExp, string][] = [
    [/spotify/, 'Spotify'],
    [/yandex.*music|яндекс/, 'Яндекс Музыка'],
    [/chrome/, 'Chrome'],
    [/msedge|microsoftedge/, 'Edge'],
    [/firefox|308046b0af4a39cb/, 'Firefox'],
    [/opera/, 'Opera'],
    [/telegram/, 'Telegram'],
    [/vlc/, 'VLC'],
    [/zunemusic|music\.ui/, 'Media Player'],
    [/applemusic|itunes/, 'Apple Music'],
    [/discord/, 'Discord'],
    [/aimp/, 'AIMP'],
    [/foobar/, 'foobar2000']
  ]
  for (const [re, name] of known) if (re.test(id)) return name
  const last = aumid.split(/[!\\/]/).pop() ?? aumid
  return last.replace(/\.exe$/i, '')
}

interface MediaLine {
  none?: boolean
  app?: string
  title?: string
  artist?: string
  album?: string
  status?: string
  position?: number
  duration?: number
  /** When the player last reported the position (ms since epoch) */
  updated?: number
  thumb?: string
}

/** Now playing from any player via Windows media sessions; also keeps a listening history. */
export class MediaConnector implements Connector {
  readonly key = 'media' as const
  readonly defaultEnabled = true
  presence: MediaPresence | null = null
  private proc: ChildProcessWithoutNullStreams | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private stopped = true
  private thumbnail: string | null = null
  readonly syncEveryMs = 30 * 60_000
  private readonly coverTried = new Set<number>()
  private syncing = false
  private lastRefresh = 0

  /** Turns the listening history into music in the library and looks up album covers. */
  async sync(env: Env): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    try {
      await this.syncLibrary(env)
    } finally {
      this.syncing = false
    }
  }

  private async syncLibrary(env: Env): Promise<void> {
    env.service.refreshMusicInLibrary()
    const missing = env.service
      .listLibrary({ kind: 'music' })
      .filter((i) => !i.coverUrl && i.source === 'tracker' && !this.coverTried.has(i.id))
    // iTunes allows ~20 requests a minute and a lookup takes up to two (world, then RU store): one item
    // every 6 s stays under it. The rest waits for the next sync.
    for (const item of missing.slice(0, 60)) {
      this.coverTried.add(item.id)
      try {
        // tracks are looked up as songs; album cards from before v8 as albums
        const url = item.externalId?.startsWith('track:')
          ? await itunesTrackCover(item.originalTitle, item.title)
          : await itunesCover(item.originalTitle || item.title, item.originalTitle ? item.title : '')
        if (url) env.service.setLibraryCover(item.id, url)
      } catch {
        // retried after the next launch
      }
      await new Promise((r) => setTimeout(r, 6000))
    }
  }

  private readonly trackCovers = new Map<string, string | null>()

  /** Browsers often give no picture: borrow the track's album art from iTunes. */
  private findCover(env: Env, artist: string, title: string): void {
    const key = `${artist}|${title}`.toLowerCase()
    const apply = (url: string): void => {
      if (!this.presence || this.presence.title !== title || this.thumbnail) return
      this.thumbnail = url
      this.presence = { ...this.presence, thumbnail: url }
      env.broadcast('tracker')
    }
    if (this.trackCovers.has(key)) {
      const url = this.trackCovers.get(key)
      if (url) apply(url)
      return
    }
    this.trackCovers.set(key, null)
    itunesTrackCover(artist, title)
      .then((url) => {
        if (!url) return
        this.trackCovers.set(key, url)
        apply(url)
      })
      .catch(() => {})
  }

  /** Remote for whatever plays now (Yandex Music in a browser, Spotify…). */
  control(action: MediaAction): Promise<void> {
    return controlMedia(action, this.presence?.source ?? '')
  }

  start(env: Env): void {
    if (process.platform !== 'win32') return
    this.stopped = false
    this.spawn(env)
    env.setState({ connected: true, error: null })
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.proc?.kill()
    this.proc = null
    this.presence = null
  }

  private spawn(env: Env): void {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true
    })
    this.proc = proc
    let buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('{')) this.handle(env, line)
      }
    })
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null
      if (this.stopped) return
      env.service.closeMedia(Date.now())
      this.restartTimer = setTimeout(() => this.spawn(env), 30_000)
    })
  }

  private handle(env: Env, line: string): void {
    let msg: MediaLine
    try {
      msg = JSON.parse(line) as MediaLine
    } catch {
      return
    }
    const now = Date.now()
    // timehub's own player logs its plays itself
    if (msg.app && /timehub/i.test(msg.app)) msg = { none: true }
    if (msg.none || !msg.app || !msg.title) {
      env.service.closeMedia(now)
      if (this.presence) {
        this.presence = null
        env.broadcast('tracker')
      }
      return
    }
    const trackChanged = !this.presence || this.presence.title !== msg.title || this.presence.artist !== (msg.artist ?? '')
    if (msg.thumb) this.thumbnail = `data:image/png;base64,${msg.thumb}`
    else if (trackChanged) this.thumbnail = null
    const playing = msg.status === 'Playing'
    const kind = mediaKind({ source: msg.app, artist: msg.artist ?? '', album: msg.album ?? '' })
    this.presence = {
      source: msg.app,
      sourceName: mediaSourceName(msg.app),
      title: msg.title,
      artist: msg.artist ?? '',
      album: msg.album ?? '',
      playing,
      kind,
      positionMs: msg.duration ? (msg.position ?? null) : null,
      durationMs: msg.duration || null,
      // Browsers report the position rarely: count from when they did, not from this message.
      updatedAt: msg.updated && msg.updated > 0 && msg.updated <= now + 1000 ? msg.updated : now,
      thumbnail: this.thumbnail
    }
    env.service.recordMedia(
      { at: now, source: msg.app, title: msg.title, artist: msg.artist ?? '', album: msg.album ?? '', playing, kind },
      HEARTBEAT_MS
    )
    if (!this.thumbnail && kind === 'music') this.findCover(env, msg.artist ?? '', msg.title)
    // New music shows up in the library within a minute, not at the next half-hourly sync.
    if (kind === 'music' && playing && now - this.lastRefresh > 60_000) {
      this.lastRefresh = now
      void this.sync(env).catch(() => {})
    }
    env.broadcast('tracker')
  }
}
