import type { MediaKind } from './types'

const BROWSER_RE = /chrome|msedge|microsoftedge|firefox|308046b0af4a39cb|opera|brave|vivaldi|yandexbrowser/i
/** Apps that also report voice and video messages as media sessions. */
const MESSENGER_RE = /telegram/i

/** Browsers report every tab that plays sound — videos included — as a media session. */
export function isBrowserSource(aumid: string): boolean {
  return BROWSER_RE.test(aumid)
}

/**
 * Music players always play music. In a browser (or a messenger) only sessions
 * that carry an album (Yandex Music, YouTube Music, Spotify Web…) or come from
 * an auto-generated "Artist - Topic" channel count as music; the rest — YouTube,
 * Shorts, Twitch, voice messages — are videos.
 */
export function mediaKind(m: { source: string; artist: string; album: string }): MediaKind {
  if (!isBrowserSource(m.source) && !MESSENGER_RE.test(m.source)) return 'music'
  if (m.album.trim()) return 'music'
  return / - topic$/i.test(m.artist.trim()) ? 'music' : 'video'
}

/**
 * "Artist, Guest" or "Artist feat. Guest" → "Artist": the album belongs to the first name.
 * "&" is left alone — too many bands have it in their name.
 */
export function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|;|\s(?:feat|ft)\.?\s)\s*/i)[0].trim() || artist.trim()
}

/** Tracks of one album by one (main) artist share this key. */
export function albumKey(artist: string, album: string): string {
  return `${primaryArtist(artist).toLowerCase()}|${album.trim().toLowerCase()}`
}
