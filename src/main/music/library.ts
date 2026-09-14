import { app } from 'electron'
import { createReadStream, type Dirent } from 'node:fs'
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { MusicCollection, MusicTrack } from '@shared/types'
import { guessFromPath, readTags, type Tags } from './tags'

/** Local files reach the player through this scheme — and only from the chosen music folders. */
export const MEDIA_SCHEME = 'timehub-media'

// Chromium plays these; WMA and APE it can't.
const AUDIO = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav'])
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart']
const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'
}
const MAX_FILES = 20_000
const MAX_DEPTH = 8
/** Tags sit at the start of the file; big embedded pictures are skipped, the folder cover is used instead. */
const HEAD_BYTES = 256 * 1024

const encodePath = (p: string): string => Buffer.from(p, 'utf8').toString('base64url')
const decodePath = (s: string): string => Buffer.from(s, 'base64url').toString('utf8')
export const mediaUrl = (p: string): string => `${MEDIA_SCHEME}://file/${encodePath(p)}`

interface CacheEntry {
  mtime: number
  size: number
  title: string
  artist: string
  album: string
  track: number
}

const stream = (file: string, start: number, end: number): ReadableStream =>
  Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream

/** Scans the music folders (tags cached by size and mtime) and serves the files to the player. */
export class MusicLibrary {
  private readonly cache = new Map<string, CacheEntry>()
  private cacheLoaded = false
  private dirty = false
  private result: MusicCollection | null = null

  constructor(
    private readonly folders: () => string[],
    private readonly cacheFile: string
  ) {}

  /** The chosen folders, or the Windows "Music" folder when none are set. */
  resolvedFolders(): string[] {
    const list = this.folders()
    return (list.length ? list : [app.getPath('music')]).map((f) => resolve(f))
  }

  async scan(force = false): Promise<MusicCollection> {
    const folders = this.resolvedFolders()
    if (this.result && !force && this.result.folders.join('\n') === folders.join('\n')) return this.result
    await this.loadCache()
    const files: { root: string; file: string }[] = []
    const covers = new Map<string, string | null>()
    for (const root of folders) await this.walk(root, root, 0, files, covers)
    const tracks: (MusicTrack & { track: number })[] = []
    for (let i = 0; i < files.length; i += 16) {
      const batch = await Promise.all(files.slice(i, i + 16).map((f) => this.readTrack(f.root, f.file, covers.get(dirname(f.file)) ?? null)))
      for (const t of batch) if (t) tracks.push(t)
    }
    tracks.sort(
      (a, b) =>
        a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || a.track - b.track || a.title.localeCompare(b.title)
    )
    await this.saveCache()
    this.result = { folders, tracks: tracks.map(({ track: _track, ...t }) => t) }
    return this.result
  }

  private async walk(root: string, dir: string, depth: number, files: { root: string; file: string }[], covers: Map<string, string | null>): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    let cover: string | null = null
    let firstImage: string | null = null
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!e.name.startsWith('.')) await this.walk(root, full, depth + 1, files, covers)
        continue
      }
      const ext = extname(e.name).toLowerCase()
      if (AUDIO.has(ext)) {
        if (files.length < MAX_FILES) files.push({ root, file: full })
      } else if (IMAGE.has(ext)) {
        if (COVER_NAMES.includes(basename(e.name, extname(e.name)).toLowerCase())) cover = full
        else firstImage ??= full
      }
    }
    covers.set(dir, cover ?? firstImage)
  }

  private async readTrack(root: string, file: string, coverPath: string | null): Promise<(MusicTrack & { track: number }) | null> {
    let info: { mtimeMs: number; size: number }
    try {
      info = await stat(file)
    } catch {
      return null
    }
    let entry = this.cache.get(file)
    if (!entry || entry.mtime !== info.mtimeMs || entry.size !== info.size) {
      let tags: Tags = {}
      try {
        const fh = await open(file, 'r')
        try {
          const buf = Buffer.alloc(Math.min(HEAD_BYTES, info.size))
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
          tags = readTags(buf.subarray(0, bytesRead))
        } finally {
          await fh.close()
        }
      } catch {
        // unreadable: fall back to the file name
      }
      const guess = guessFromPath(relative(root, file))
      entry = {
        mtime: info.mtimeMs, size: info.size, title: tags.title || guess.title, artist: tags.artist || guess.artist,
        album: tags.album || guess.album, track: tags.track ?? guess.track
      }
      this.cache.set(file, entry)
      this.dirty = true
    }
    return {
      id: encodePath(file), path: file, url: mediaUrl(file), title: entry.title, artist: entry.artist, album: entry.album,
      cover: coverPath ? mediaUrl(coverPath) : null, folder: dirname(file), track: entry.track
    }
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return
    this.cacheLoaded = true
    try {
      for (const [k, v] of Object.entries(JSON.parse(await readFile(this.cacheFile, 'utf8')))) this.cache.set(k, v as CacheEntry)
    } catch {
      // first scan
    }
  }

  private async saveCache(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    try {
      await writeFile(this.cacheFile, JSON.stringify(Object.fromEntries(this.cache)))
    } catch {
      // the cache only saves time
    }
  }

  /** Audio and cover images inside the music folders — nothing else on disk is reachable. */
  isAllowed(file: string): boolean {
    const ext = extname(file).toLowerCase()
    if (!AUDIO.has(ext) && !IMAGE.has(ext)) return false
    const full = resolve(file).toLowerCase()
    return this.resolvedFolders().some((f) => full.startsWith(f.toLowerCase().replace(/[\\/]+$/, '') + sep))
  }

  /** `timehub-media://file/<path>` with Range support, so the player can seek. */
  async handle(request: Request): Promise<Response> {
    const file = decodePath(new URL(request.url).pathname.slice(1))
    if (!this.isAllowed(file)) return new Response('Forbidden', { status: 403 })
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    if (size === 0) return new Response('', { status: 200, headers: { 'Content-Type': type } })
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      return new Response(stream(file, start, end), {
        status: 206,
        headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }
      })
    }
    return new Response(stream(file, 0, size - 1), {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    })
  }
}
