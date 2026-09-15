/** A conversation recognised from a messenger's window title. */
export interface ChatRef {
  kind: 'dm' | 'channel' | 'chat'
  name: string
  /** e.g. the Discord channel inside a server */
  detail?: string
}

/**
 * Discord: "@alex - Discord" (a DM) or "#general | Friends - Discord" (a server channel).
 * Telegram: "Mom – (account)", with "(3) " in front when there are unread messages.
 */
export function parseChat(exeName: string, title: string): ChatRef | null {
  const exe = exeName.toLowerCase()
  const t = title.trim()
  if (!t) return null
  if (/discord|vesktop/.test(exe)) {
    const body = t
      .replace(/\s[-–—]\sDiscord$/i, '')
      .replace(/^Discord\s?\|\s?/i, '')
      .trim()
    if (!body || /^discord$/i.test(body)) return null
    const parts = body
      .split(/\s\|\s/)
      .map((p) => p.trim())
      .filter(Boolean)
    const dm = parts.find((p) => p.startsWith('@'))
    if (dm) return { kind: 'dm', name: dm.slice(1).trim() }
    const channel = parts.find((p) => p.startsWith('#'))
    const server = parts.find((p) => !p.startsWith('#'))
    if (server) return channel ? { kind: 'channel', name: server, detail: channel } : { kind: 'channel', name: server }
    return channel ? { kind: 'channel', name: channel } : null
  }
  if (/telegram|ayugram/.test(exe)) {
    const m = /^(?:\(\d+\)\s*)?(.+?)\s[–—-]\s\([^)]*\)$/.exec(t)
    return m ? { kind: 'chat', name: m[1].trim() } : null
  }
  return null
}
