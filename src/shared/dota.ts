import type { Lang } from './types'

const STEAM_ID_BASE = 76561197960265728n

/** SteamID64 → the 32-bit account id Dota (and OpenDota/Dotabuff) use. */
export function toAccountId(steamId64: string): string {
  try {
    const id = BigInt(steamId64) - STEAM_ID_BASE
    return id > 0n ? id.toString() : ''
  } catch {
    return ''
  }
}

const MEDALS: Record<Lang, string[]> = {
  ru: ['Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'],
  en: ['Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal']
}

/** rank_tier 44 → "Герой 4" (medal and stars); Immortal has no stars. */
export function rankName(rankTier: number | null, lang: Lang): string | null {
  if (!rankTier) return null
  const medal = Math.floor(rankTier / 10)
  const stars = rankTier % 10
  const name = MEDALS[lang][medal - 1]
  if (!name) return null
  return medal === 8 || !stars ? name : `${name} ${stars}`
}

export function rankIcons(rankTier: number | null): { medal: string; star: string | null } | null {
  if (!rankTier) return null
  const medal = Math.floor(rankTier / 10)
  const stars = rankTier % 10
  const base = 'https://www.opendota.com/assets/images/dota2/rank_icons'
  return { medal: `${base}/rank_icon_${medal}.png`, star: medal < 8 && stars ? `${base}/rank_star_${stars}.png` : null }
}

/** Slots 0–127 are Radiant, 128+ Dire. */
export const isWin = (playerSlot: number, radiantWin: boolean): boolean => playerSlot < 128 === radiantWin

export const heroImage = (npcName: string): string =>
  `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${npcName.replace(/^npc_dota_hero_/, '')}.png`

const MODES: Record<number, [ru: string, en: string]> = {
  1: ['Все выбирают', 'All Pick'],
  2: ['Режим капитанов', "Captains Mode"],
  3: ['Случайный выбор', 'Random Draft'],
  4: ['Одиночный выбор', 'Single Draft'],
  5: ['Всё случайно', 'All Random'],
  16: ['Выбор капитанов', "Captains Draft"],
  18: ['Выбор способностей', 'Ability Draft'],
  20: ['Всё случайно: бой насмерть', 'All Random Deathmatch'],
  21: ['1 на 1 (мид)', '1v1 Mid'],
  22: ['Все выбирают', 'All Pick'],
  23: ['Турбо', 'Turbo']
}

export function gameModeName(mode: number, lang: Lang): string {
  const m = MODES[mode]
  return m ? m[lang === 'ru' ? 0 : 1] : lang === 'ru' ? `Режим ${mode}` : `Mode ${mode}`
}
