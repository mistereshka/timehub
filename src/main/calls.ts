import { execFile } from 'node:child_process'
import type { Service } from '@shared/service'
import type { TrackerStatus } from '@shared/types'

// Windows notes when each app last used the microphone (Settings → Privacy → Microphone).
const CONSENT_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone`
const MESSENGERS: [RegExp, string][] = [
  [/discord|vesktop/i, 'Discord'], [/telegram|ayugram/i, 'Telegram'], [/whatsapp/i, 'WhatsApp'], [/zoom/i, 'Zoom'],
  [/teams/i, 'Teams'], [/skype/i, 'Skype'], [/viber/i, 'Viber'], [/signal/i, 'Signal'], [/element/i, 'Element']
]
/** A "still in use" record older than this is left over from an old app version, not a call. */
const LIVE_WINDOW_MS = 12 * 60 * 60_000
const MIN_CALL_MS = 20_000
const FILETIME_EPOCH_MS = 11_644_473_600_000n

export interface MicUse {
  /** Registry key name: an exe path with # instead of \, or a Store package name */
  key: string
  exePath: string
  app: string
  start: number
  /** 0 while the app still holds the microphone */
  stop: number
}

const fromFiletime = (hex: string): number => {
  const v = BigInt(`0x${hex}`)
  return v === 0n ? 0 : Number(v / 10_000n - FILETIME_EPOCH_MS)
}

/** Parses `reg query <ConsentStore\microphone> /s` into messenger microphone uses. */
export function parseMicUsage(text: string): MicUse[] {
  const out: MicUse[] = []
  let cur: MicUse | null = null
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      const key = line.split('\\').pop()!.trim()
      const app = MESSENGERS.find(([re]) => re.test(key))?.[1]
      cur = app ? { key, exePath: key.includes('#') ? key.replace(/#/g, '\\') : key, app, start: 0, stop: 0 } : null
      if (cur) out.push(cur)
      continue
    }
    const m = /^\s+(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+0x([0-9a-f]+)/i.exec(line)
    if (!cur || !m) continue
    if (m[1] === 'LastUsedTimeStart') cur.start = fromFiletime(m[2])
    else cur.stop = fromFiletime(m[2])
  }
  return out.filter((u) => u.start > 0)
}

function regQuery(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

/**
 * Calls in Telegram, Discord and other messengers: an app holding the
 * microphone is on a call (or in a voice channel). Finished calls — including
 * the last one Windows remembers for each app — go to the history.
 */
export class CallTracker {
  current: TrackerStatus['call'] = null

  constructor(
    private readonly service: Service,
    private readonly runningPaths: () => Set<string>,
    private readonly onChange: () => void
  ) {}

  async poll(now = Date.now()): Promise<void> {
    if (process.platform !== 'win32') return
    const uses = parseMicUsage(await regQuery(CONSENT_KEY))
    const running = this.runningPaths()
    const isRunning = (u: MicUse): boolean => {
      if (!running.size) return true // the process list isn't known yet
      if (u.exePath.includes('\\')) return running.has(u.exePath.toLowerCase())
      return [...running].some((p) => p.includes(u.app.toLowerCase()))
    }
    let live: TrackerStatus['call'] = null
    for (const u of uses) {
      if (u.stop === 0) {
        if (u.start < now - LIVE_WINDOW_MS || !isRunning(u)) continue
        const call = this.service.upsertCall({ exePath: u.exePath, app: u.app, start: u.start, end: now })
        if (!live || call.start > live.since) live = { app: call.app, icon: call.icon, since: call.start, context: call.context }
      } else if (u.stop - u.start >= MIN_CALL_MS) {
        this.service.upsertCall({ exePath: u.exePath, app: u.app, start: u.start, end: u.stop })
      }
    }
    if (JSON.stringify(live) !== JSON.stringify(this.current)) {
      this.current = live
      this.onChange()
    }
  }
}
