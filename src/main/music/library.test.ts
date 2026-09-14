import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MusicLibrary, mediaUrl } from './library'

const root = mkdtempSync(join(tmpdir(), 'timehub-music-'))
const outside = mkdtempSync(join(tmpdir(), 'timehub-outside-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('music library', () => {
  const albumDir = join(root, 'Кино', 'Группа крови')
  mkdirSync(albumDir, { recursive: true })
  const track = join(albumDir, '01 - Группа крови.mp3')
  writeFileSync(track, Buffer.from('0123456789abcdef'))
  writeFileSync(join(albumDir, 'cover.jpg'), Buffer.from('jpeg'))
  const secret = join(outside, 'secret.mp3')
  writeFileSync(secret, Buffer.from('not yours'))
  const lib = new MusicLibrary(() => [root], join(outside, 'cache.json'))

  it('finds tracks with names from the folders and the folder cover', async () => {
    const { tracks } = await lib.scan(true)
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ title: 'Группа крови', artist: 'Кино', album: 'Группа крови', url: mediaUrl(track) })
    expect(tracks[0].cover).toBe(mediaUrl(join(albumDir, 'cover.jpg')))
  })

  it('streams a file with ranges so the player can seek', async () => {
    const part = await lib.handle(new Request(mediaUrl(track), { headers: { Range: 'bytes=4-7' } }))
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 4-7/16')
    expect(await part.text()).toBe('4567')
    const whole = await lib.handle(new Request(mediaUrl(track)))
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('audio/mpeg')
  })

  it('serves nothing outside the music folders', async () => {
    expect((await lib.handle(new Request(mediaUrl(secret)))).status).toBe(403)
    expect((await lib.handle(new Request(mediaUrl(join(root, '..', 'x.txt'))))).status).toBe(403)
  })
})
