import { describe, expect, it } from 'vitest'
import { parseMicUsage } from './calls'

const filetime = (ms: number): string => ((BigInt(ms) + 11_644_473_600_000n) * 10_000n).toString(16)

describe('microphone records', () => {
  it('finds messenger calls and the one still going', () => {
    const start = Date.UTC(2026, 8, 14, 17, 51, 26)
    const stop = Date.UTC(2026, 8, 14, 18, 14, 25)
    const now = Date.UTC(2026, 8, 15, 20, 0, 0)
    const base = String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone`
    const text = [
      String.raw`${base}\NonPackaged\C:#Users#me#AppData#Roaming#Telegram Desktop#Telegram.exe`,
      `    LastUsedTimeStart    REG_QWORD    0x${filetime(start)}`,
      `    LastUsedTimeStop    REG_QWORD    0x${filetime(stop)}`,
      '',
      String.raw`${base}\NonPackaged\C:#Users#me#AppData#Local#Discord#app-1.0.9200#Discord.exe`,
      `    LastUsedTimeStart    REG_QWORD    0x${filetime(now)}`,
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      String.raw`${base}\NonPackaged\C:#Program Files#Google#Chrome#Application#chrome.exe`,
      `    LastUsedTimeStart    REG_QWORD    0x${filetime(start)}`,
      `    LastUsedTimeStop    REG_QWORD    0x${filetime(stop)}`
    ].join('\r\n')
    const uses = parseMicUsage(text)
    expect(uses.map((u) => [u.app, u.start, u.stop])).toEqual([
      ['Telegram', start, stop],
      ['Discord', now, 0]
    ])
    expect(uses[1].exePath).toBe(String.raw`C:\Users\me\AppData\Local\Discord\app-1.0.9200\Discord.exe`)
  })
})
