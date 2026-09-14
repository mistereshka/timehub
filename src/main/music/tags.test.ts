import { describe, expect, it } from 'vitest'
import { guessFromPath, readTags } from './tags'

const synchsafe = (n: number): number[] => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const u32be = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

function id3(frames: [string, string][], version = 3): Buffer {
  const body = Buffer.concat(
    frames.map(([id, text]) => {
      const data = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')])
      const size = version === 4 ? Buffer.from(synchsafe(data.length)) : u32be(data.length)
      return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.from([0, 0]), data])
    })
  )
  return Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([version, 0, 0]), Buffer.from(synchsafe(body.length)), body, Buffer.alloc(64)])
}

function flac(comments: string[]): Buffer {
  const vendor = Buffer.from('timehub', 'utf8')
  const block = Buffer.concat([
    u32le(vendor.length),
    vendor,
    u32le(comments.length),
    ...comments.flatMap((c) => {
      const b = Buffer.from(c, 'utf8')
      return [u32le(b.length), b]
    })
  ])
  const header = Buffer.from([0x80 | 4, (block.length >> 16) & 0xff, (block.length >> 8) & 0xff, block.length & 0xff])
  return Buffer.concat([Buffer.from('fLaC', 'latin1'), header, block])
}

describe('music tags', () => {
  it('reads ID3v2.3 and v2.4 text frames', () => {
    const frames: [string, string][] = [
      ['TIT2', 'Группа крови'],
      ['TPE1', 'Кино'],
      ['TALB', 'Группа крови'],
      ['TRCK', '1/11']
    ]
    const want = { title: 'Группа крови', artist: 'Кино', album: 'Группа крови', track: 1 }
    expect(readTags(id3(frames, 3))).toEqual(want)
    expect(readTags(id3(frames, 4))).toEqual(want)
  })

  it('reads FLAC Vorbis comments', () => {
    expect(readTags(flac(['TITLE=Выхода нет', 'ARTIST=Сплин', 'ALBUM=Гранатовый альбом', 'TRACKNUMBER=3']))).toEqual({
      title: 'Выхода нет',
      artist: 'Сплин',
      album: 'Гранатовый альбом',
      track: 3
    })
  })

  it('returns nothing for files without tags', () => {
    expect(readTags(Buffer.from('just some audio bytes'))).toEqual({})
  })

  it('guesses from the folder and the file name', () => {
    expect(guessFromPath('Кино/Группа крови/01 - Группа крови.mp3')).toEqual({ title: 'Группа крови', artist: 'Кино', album: 'Группа крови', track: 1 })
    expect(guessFromPath('Сплин - Выхода нет.mp3')).toEqual({ title: 'Выхода нет', artist: 'Сплин', album: '', track: 0 })
  })
})
