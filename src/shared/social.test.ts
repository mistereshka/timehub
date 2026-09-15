import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../main/db'
import { Service } from './service'
import { parseChat } from './social'
import { DAY, MINUTE } from './time'

describe('chats from window titles', () => {
  it('reads Discord DMs and server channels', () => {
    expect(parseChat('Discord.exe', '@alex - Discord')).toEqual({ kind: 'dm', name: 'alex' })
    expect(parseChat('Discord.exe', '#general | Friends - Discord')).toEqual({ kind: 'channel', name: 'Friends', detail: '#general' })
    expect(parseChat('Discord.exe', 'Discord')).toBeNull()
  })

  it('reads Telegram chats', () => {
    expect(parseChat('Telegram.exe', 'Мама – (demo)')).toEqual({ kind: 'chat', name: 'Мама' })
    expect(parseChat('Telegram.exe', '(3) Команда timehub – (demo)')).toEqual({ kind: 'chat', name: 'Команда timehub' })
    expect(parseChat('Telegram.exe', 'Telegram')).toBeNull()
    expect(parseChat('chrome.exe', '@alex - Discord')).toBeNull()
  })
})

describe('social summary', () => {
  it('adds up messaging, chats and calls', () => {
    const t0 = new Date(2026, 8, 15, 20, 0, 0).getTime()
    const svc = new Service(openNodeDb(':memory:'), { now: () => t0 + 2 * 60 * MINUTE, language: 'ru' })
    const exe = 'C:/Discord/app-1.0/Discord.exe'
    const discord = svc.ensureApp(exe, 'Discord.exe', 'Discord').app
    svc.seedSession(discord.id, '@alex - Discord', t0, t0 + 20 * MINUTE)
    svc.seedSession(discord.id, '#general | Friends - Discord', t0 + 20 * MINUTE, t0 + 30 * MINUTE)

    const call = svc.upsertCall({ exePath: exe, app: 'Discord', start: t0 + 5 * MINUTE, end: t0 + 10 * MINUTE })
    expect(call).toMatchObject({ app: 'Discord', context: 'alex', appId: discord.id })
    svc.upsertCall({ exePath: exe, app: 'Discord', start: t0 + 5 * MINUTE, end: t0 + 35 * MINUTE }) // still going
    expect(svc.listCalls(t0, t0 + DAY)).toHaveLength(1)

    const s = svc.getSocial(t0 - MINUTE, t0 + DAY)
    expect(s).toMatchObject({ messagingMs: 30 * MINUTE, callCount: 1, callMs: 30 * MINUTE, longestCallMs: 30 * MINUTE, streak: 1 })
    expect(s.chats.map((c) => [c.kind, c.name, c.ms])).toEqual([
      ['dm', 'alex', 20 * MINUTE],
      ['channel', 'Friends', 10 * MINUTE]
    ])
    expect(s.byApp[0]).toMatchObject({ appId: discord.id, ms: 30 * MINUTE, calls: 1, callMs: 30 * MINUTE })
  })
})
