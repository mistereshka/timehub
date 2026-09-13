import { describe, expect, it } from 'vitest'
import { guessCategoryKey, looksLikeGame, prettifyExeName } from './catalog'

describe('app catalog', () => {
  it('detects games by known exe names and store folders', () => {
    expect(looksLikeGame('RobloxPlayerBeta.exe', 'C:\\Users\\me\\AppData\\Local\\Roblox\\Versions\\v1\\RobloxPlayerBeta.exe')).toBe(true)
    expect(looksLikeGame('Hades2.exe', 'D:\\SteamLibrary\\steamapps\\common\\Hades II\\Ship\\Hades2.exe')).toBe(true)
    expect(looksLikeGame('Code.exe', 'C:\\Program Files\\Microsoft VS Code\\Code.exe')).toBe(false)
  })

  it('ignores launchers, crash handlers and updaters inside game folders', () => {
    expect(looksLikeGame('RiotClientCrashHandler.exe', 'C:\\Riot Games\\Riot Client\\RiotClientCrashHandler.exe')).toBe(false)
    expect(looksLikeGame('UnityCrashHandler64.exe', 'D:\\SteamLibrary\\steamapps\\common\\Game\\UnityCrashHandler64.exe')).toBe(false)
    expect(looksLikeGame('EpicGamesLauncher.exe', 'C:\\Program Files\\Epic Games\\Launcher\\EpicGamesLauncher.exe')).toBe(false)
    expect(looksLikeGame('steam.exe', 'C:\\Program Files (x86)\\Steam\\steam.exe')).toBe(false)
  })

  it('guesses categories and readable names', () => {
    expect(guessCategoryKey('Discord.exe', false)).toBe('social')
    expect(guessCategoryKey('Docker Desktop.exe', false)).toBe('dev')
    expect(guessCategoryKey('whatever.exe', true)).toBe('games')
    expect(guessCategoryKey('whatever.exe', false)).toBe('other')
    expect(prettifyExeName('sublime_text.exe')).toBe('Sublime text')
  })
})
