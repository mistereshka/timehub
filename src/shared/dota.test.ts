import { describe, expect, it } from 'vitest'
import { gameModeName, heroImage, isWin, rankIcons, rankName, toAccountId } from './dota'

describe('dota', () => {
  it('turns a SteamID64 into a Dota account id', () => {
    expect(toAccountId('76561197960265729')).toBe('1')
    expect(toAccountId('not a number')).toBe('')
  })

  it('names ranks like the game does', () => {
    expect(rankName(44, 'ru')).toBe('Герой 4')
    expect(rankName(22, 'en')).toBe('Guardian 2')
    expect(rankName(80, 'ru')).toBe('Титан')
    expect(rankName(null, 'ru')).toBeNull()
    expect(rankIcons(44)).toEqual({
      medal: 'https://www.opendota.com/assets/images/dota2/rank_icons/rank_icon_4.png',
      star: 'https://www.opendota.com/assets/images/dota2/rank_icons/rank_star_4.png'
    })
  })

  it('knows who won from the player slot', () => {
    expect(isWin(3, true)).toBe(true)
    expect(isWin(3, false)).toBe(false)
    expect(isWin(130, false)).toBe(true)
  })

  it('builds hero images and mode names', () => {
    expect(heroImage('npc_dota_hero_antimage')).toBe('https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/antimage.png')
    expect(gameModeName(23, 'ru')).toBe('Турбо')
    expect(gameModeName(22, 'en')).toBe('All Pick')
  })
})
