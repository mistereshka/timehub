import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../main/db'
import { looksLikeGame } from './catalog'
import {
  UNKNOWN_MINECRAFT, clockLogStart, debugLogStart, instanceAt, instanceForProcess, instanceLabels, isMinecraftWindow, minecraftInstanceOf,
  packInfo, parseInstanceCfg
} from './minecraft'
import { Service } from './service'
import { MINUTE } from './time'

describe('minecraft', () => {
  it('recognises the game window inside Java', () => {
    expect(isMinecraftWindow('javaw.exe', 'Minecraft* Forge 1.20.1 - Одиночная игра')).toBe(true)
    expect(isMinecraftWindow('java.exe', 'Minecraft 1.21.1')).toBe(true)
    expect(isMinecraftWindow('javaw.exe', 'IntelliJ IDEA')).toBe(false)
    expect(isMinecraftWindow('chrome.exe', 'Minecraft Wiki - Google Chrome')).toBe(false)
    expect(minecraftInstanceOf('minecraft:1.20.1(2)')).toBe('1.20.1(2)')
    expect(minecraftInstanceOf('C:\\Games\\javaw.exe')).toBeNull()
    expect(looksLikeGame('minecraft', 'minecraft:1.20.1(2)')).toBe(true)
  })

  it('reads Prism instance files', () => {
    const cfg = parseInstanceCfg('[General]\nConfigVersion=1.2\nname="Create: Above & Beyond"\nlastLaunchTime=1789601809192\ntotalTimePlayed=12334\n')
    expect(cfg).toMatchObject({ name: 'Create: Above & Beyond', lastLaunchTime: '1789601809192', totalTimePlayed: '12334' })
    expect(cfg.General).toBeUndefined()
    const forge = {
      components: [
        { uid: 'org.lwjgl3', version: '3.3.1' },
        { uid: 'net.minecraft', version: '1.20.1' },
        { uid: 'net.minecraftforge', version: '47.4.20' }
      ]
    }
    expect(packInfo(forge)).toEqual({ mcVersion: '1.20.1', loader: 'Forge', loaderVersion: '47.4.20' })
    expect(packInfo({ components: [{ uid: 'net.minecraft', version: '1.21.1' }] })).toEqual({ mcVersion: '1.21.1', loader: null, loaderVersion: null })
    expect(packInfo(null).mcVersion).toBeNull()
  })

  it('tells apart instances that share a name', () => {
    const labels = instanceLabels([
      { id: '1.21.1', name: '1.21.1', loader: 'NeoForge' },
      { id: '1.21.1(2)', name: '1.21.1', loader: 'NeoForge' },
      { id: 'my pack', name: '1.21.1', loader: 'NeoForge' },
      { id: '1.20.1(2)', name: '1.20.1', loader: 'Forge' },
      { id: '1.20.1', name: '1.20.1', loader: null }
    ])
    expect(labels.get('1.20.1(2)')).toBe('1.20.1 · Forge')
    expect(labels.get('1.20.1')).toBe('1.20.1 · Vanilla')
    expect(labels.get('1.21.1(2)')).toBe('1.21.1 · NeoForge (2)')
    expect(labels.get('1.21.1')).toBe('1.21.1 · NeoForge')
    expect(labels.get('my pack')).toBe('1.21.1 · NeoForge (my pack)')
  })

  it('dates runs from their logs', () => {
    expect(debugLogStart('[17Sep2026 02:37:01.063] [main/INFO] [cpw.mods.modlauncher.Launcher/MODLAUNCHER]: ModLauncher running')).toBe(
      new Date(2026, 8, 17, 2, 37, 1).getTime()
    )
    expect(debugLogStart('garbage')).toBeNull()
    const end = new Date(2026, 8, 16, 1, 10).getTime()
    // started before midnight, ended after it
    expect(clockLogStart('[23:40:05] [main/INFO]: Loading', end)).toBe(new Date(2026, 8, 15, 23, 40, 5).getTime())
    expect(clockLogStart('[00:20:00] [main/INFO]: Loading', end)).toBe(new Date(2026, 8, 16, 0, 20).getTime())
  })

  it('finds the instance of a past session or a running process', () => {
    const at = (h: number, m: number): number => new Date(2026, 8, 16, h, m).getTime()
    const runs = [
      { id: 'a', runs: [{ start: at(1, 45), end: at(4, 30) }] },
      { id: 'b', runs: [{ start: at(12, 0), end: at(13, 0) }] }
    ]
    expect(instanceAt(runs, at(2, 10))).toBe('a')
    expect(instanceAt(runs, at(12, 30))).toBe('b')
    expect(instanceAt(runs, at(8, 0))).toBeNull()
    const launched = [
      { id: 'a', lastLaunch: at(2, 36) },
      { id: 'b', lastLaunch: at(1, 0) },
      { id: 'c', lastLaunch: null }
    ]
    expect(instanceForProcess(launched, at(2, 36) + 20_000)).toBe('a')
    expect(instanceForProcess(launched, at(1, 5))).toBe('b')
    expect(instanceForProcess(launched, at(9, 0))).toBeNull()
  })

  it('moves Minecraft played inside Java to its instance, once', () => {
    const clock = { now: new Date(2026, 8, 17, 10, 0).getTime() }
    const svc = new Service(openNodeDb(':memory:'), { now: () => clock.now, language: 'ru' })
    const { app: java } = svc.ensureApp('C:\\Prism\\java\\bin\\javaw.exe', 'javaw.exe', 'OpenJDK Platform binary')
    const t = new Date(2026, 8, 16, 2, 0).getTime()
    svc.seedSession(java.id, 'Minecraft* Forge 1.20.1', t, t + 30 * MINUTE)
    svc.seedSession(java.id, 'Some Java tool', t + 40 * MINUTE, t + 50 * MINUTE)
    const resolve = (at: number) =>
      at < t + 35 * MINUTE ? { exePath: 'minecraft:1.20.1(2)', name: 'Minecraft 1.20.1 · Forge', icon: null } : UNKNOWN_MINECRAFT
    expect(svc.splitMinecraftSessions(resolve)).toBe(1)
    expect(svc.splitMinecraftSessions(resolve)).toBe(0)
    const mc = svc.listApps().find((a) => a.exePath === 'minecraft:1.20.1(2)')!
    expect(mc).toMatchObject({ displayName: 'Minecraft 1.20.1 · Forge', isGame: true })
    expect(svc.appPlayTotals().get(mc.id)?.ms).toBe(30 * MINUTE)
  })
})
