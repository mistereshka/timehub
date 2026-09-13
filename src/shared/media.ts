import type { MediaKind } from './types'

const BROWSER_RE = /chrome|msedge|microsoftedge|firefox|308046b0af4a39cb|opera|brave|vivaldi|yandexbrowser/i

/** Browsers report every tab that plays sound — videos included — as a media session. */
export function isBrowserSource(aumid: string): boolean {
  return BROWSER_RE.test(aumid)
}

/**
 * Music players always play music. In a browser only sessions that carry an
 * album (YouTube Music, Spotify Web, Yandex Music…) or come from an
 * auto-generated "Artist - Topic" channel count as music; the rest — YouTube,
 * Shorts, Twitch — are videos.
 */
export function mediaKind(m: { source: string; artist: string; album: string }): MediaKind {
  if (!isBrowserSource(m.source)) return 'music'
  if (m.album.trim()) return 'music'
  return / - topic$/i.test(m.artist.trim()) ? 'music' : 'video'
}
