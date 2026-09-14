/** Title, artist, album and track number from the start of an audio file (ID3v2 for MP3, Vorbis comments for FLAC). */
export interface Tags {
  title?: string
  artist?: string
  album?: string
  track?: number
}

const NUL = String.fromCharCode(0)

function swap16(b: Buffer): Buffer {
  return Buffer.from(b.subarray(0, b.length - (b.length % 2))).swap16()
}

function decodeText(body: Buffer, encoding: number): string {
  let text: string
  if (encoding === 0) text = body.toString('latin1')
  else if (encoding === 1) {
    // UTF-16 with a byte order mark
    if (body[0] === 0xfe && body[1] === 0xff) text = swap16(body.subarray(2)).toString('utf16le')
    else text = body.subarray(body[0] === 0xff && body[1] === 0xfe ? 2 : 0).toString('utf16le')
  } else if (encoding === 2) text = swap16(body).toString('utf16le')
  else text = body.toString('utf8')
  return text.split(NUL)[0].trim()
}

const synchsafe = (b: Buffer, o: number): number => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)

const FRAMES: Record<string, keyof Tags> = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TRCK: 'track', TRK: 'track'
}

export function readId3(buf: Buffer): Tags | null {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return null
  const version = buf[3]
  const v22 = version === 2
  const end = Math.min(buf.length, 10 + synchsafe(buf, 6))
  let pos = 10
  if (!v22 && buf[5] & 0x40) pos += version === 4 ? synchsafe(buf, 10) : buf.readUInt32BE(10) + 4 // extended header
  const header = v22 ? 6 : 10
  const tags: Tags = {}
  while (pos + header <= end) {
    const id = buf.toString('latin1', pos, pos + (v22 ? 3 : 4))
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break
    const size = v22
      ? (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5]
      : version === 4
        ? synchsafe(buf, pos + 4)
        : buf.readUInt32BE(pos + 4)
    const start = pos + header
    if (size <= 0 || start + size > end) break
    const key = FRAMES[id]
    if (key) {
      const text = decodeText(buf.subarray(start + 1, start + size), buf[start])
      if (key === 'track') tags.track = parseInt(text, 10) || undefined
      else if (text) tags[key] = text
    }
    pos = start + size
  }
  return tags
}

function readVorbis(b: Buffer): Tags {
  const tags: Tags = {}
  let p = 0
  if (b.length < 8) return tags
  p += 4 + b.readUInt32LE(0) // vendor string
  if (p + 4 > b.length) return tags
  const count = b.readUInt32LE(p)
  p += 4
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = b.readUInt32LE(p)
    p += 4
    const entry = b.toString('utf8', p, Math.min(b.length, p + len))
    p += len
    const eq = entry.indexOf('=')
    if (eq < 0) continue
    const key = entry.slice(0, eq).toUpperCase()
    const value = entry.slice(eq + 1).trim()
    if (!value) continue
    if (key === 'TITLE') tags.title = value
    else if (key === 'ARTIST') tags.artist ??= value
    else if (key === 'ALBUM') tags.album = value
    else if (key === 'TRACKNUMBER') tags.track = parseInt(value, 10) || undefined
  }
  return tags
}

export function readFlac(buf: Buffer): Tags | null {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'fLaC') return null
  let pos = 4
  while (pos + 4 <= buf.length) {
    const head = buf[pos]
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]
    const start = pos + 4
    if ((head & 0x7f) === 4) return start + len <= buf.length ? readVorbis(buf.subarray(start, start + len)) : {}
    if (head & 0x80) break // last metadata block
    pos = start + len
  }
  return {}
}

export function readTags(buf: Buffer): Tags {
  return readId3(buf) ?? readFlac(buf) ?? {}
}

/**
 * Tags from the file's place in the library when the file has none:
 * "Artist/Album/01 - Title.mp3" or "Artist - Title.mp3". `rel` is relative to the music folder.
 */
export function guessFromPath(rel: string): { title: string; artist: string; album: string; track: number } {
  const parts = rel.split(/[\\/]/).filter(Boolean)
  const name = (parts[parts.length - 1] ?? '').replace(/\.[^.]+$/, '')
  const num = /^(\d{1,3})[\s._-]+/.exec(name)
  let title = name.replace(/^\d{1,3}[\s._-]+/, '').trim()
  let artist = parts.length >= 3 ? parts[parts.length - 3] : ''
  const album = parts.length >= 2 ? parts[parts.length - 2] : ''
  const dash = title.split(/\s[-–—]\s/)
  if (dash.length >= 2) {
    artist = dash[0].trim()
    title = dash.slice(1).join(' - ').trim()
  }
  return { title: title || name, artist, album, track: num ? Number(num[1]) : 0 }
}
