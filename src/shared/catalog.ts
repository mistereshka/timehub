import type { Lang } from './types'

export type CategoryKey = 'dev' | 'work' | 'browser' | 'social' | 'media' | 'games' | 'other'

export const DEFAULT_CATEGORIES: { key: CategoryKey; name: string; color: string }[] = [
  { key: 'dev', name: 'Development', color: '#3178c6' },
  { key: 'work', name: 'Work', color: '#2da44e' },
  { key: 'browser', name: 'Browsing', color: '#e34c26' },
  { key: 'social', name: 'Communication', color: '#8250df' },
  { key: 'media', name: 'Media', color: '#db61a2' },
  { key: 'games', name: 'Games', color: '#f1e05a' },
  { key: 'other', name: 'Other', color: '#8b949e' }
]

export const DEFAULT_LABELS: Record<Lang, { name: string; color: string }[]> = {
  ru: [
    { name: 'работа', color: '#0075ca' },
    { name: 'личное', color: '#7057ff' },
    { name: 'учёба', color: '#008672' },
    { name: 'здоровье', color: '#0e8a16' },
    { name: 'срочно', color: '#d73a4a' },
    { name: 'идея', color: '#a2eeef' }
  ],
  en: [
    { name: 'work', color: '#0075ca' },
    { name: 'personal', color: '#7057ff' },
    { name: 'study', color: '#008672' },
    { name: 'health', color: '#0e8a16' },
    { name: 'urgent', color: '#d73a4a' },
    { name: 'idea', color: '#a2eeef' }
  ]
}

/** Palette offered when picking a label / project / category color (GitHub label colors). */
export const COLOR_PALETTE = [
  '#b60205', '#d93f0b', '#fbca04', '#0e8a16', '#006b75', '#1d76db', '#0052cc', '#5319e7',
  '#e99695', '#f9d0c4', '#fef2c0', '#c2e0c6', '#bfdadc', '#c5def5', '#bfd4f2', '#d4c5f9'
]

const EXE_CATEGORY: Record<string, CategoryKey> = {}
/** Whitespace-separated exe names; names containing spaces go in double quotes. */
const add = (key: CategoryKey, exes: string): void => {
  for (const m of exes.matchAll(/"([^"]+)"|(\S+)/g)) EXE_CATEGORY[m[1] ?? m[2]] = key
}
add('dev', `code.exe code-insiders.exe cursor.exe windsurf.exe zed.exe devenv.exe idea64.exe pycharm64.exe
  webstorm64.exe rider64.exe clion64.exe goland64.exe phpstorm64.exe rustrover64.exe datagrip64.exe studio64.exe
  sublime_text.exe notepad++.exe windowsterminal.exe wt.exe powershell.exe pwsh.exe cmd.exe githubdesktop.exe
  gitkraken.exe fork.exe postman.exe insomnia.exe "docker desktop.exe" dbeaver.exe unity.exe unityhub.exe
  ue4editor.exe unrealeditor.exe godot.exe`)
add('work', `winword.exe excel.exe powerpnt.exe outlook.exe olk.exe onenote.exe notion.exe obsidian.exe
  figma.exe acrobat.exe acrord32.exe sumatrapdf.exe thunderbird.exe claude.exe chatgpt.exe logseq.exe
  anki.exe photoshop.exe illustrator.exe afterfx.exe "adobe premiere pro.exe" blender.exe krita.exe
  libreoffice.exe soffice.bin clickup.exe linear.exe todoist.exe ticktick.exe evernote.exe xmind.exe`)
add('browser', `chrome.exe msedge.exe firefox.exe opera.exe opera_gx.exe brave.exe vivaldi.exe browser.exe
  arc.exe zen.exe iexplore.exe librewolf.exe waterfox.exe thorium.exe`)
add('social', `discord.exe discordptb.exe discordcanary.exe telegram.exe ayugram.exe slack.exe teams.exe
  ms-teams.exe whatsapp.exe whatsapp.root.exe skype.exe zoom.exe viber.exe signal.exe element.exe
  vesktop.exe mattermost.exe`)
add('media', `spotify.exe vlc.exe mpc-hc64.exe mpc-be64.exe potplayermini64.exe potplayer64.exe mpv.exe
  obs64.exe yandexmusic.exe "яндекс музыка.exe" itunes.exe applemusic.exe wmplayer.exe music.ui.exe
  video.ui.exe aimp.exe foobar2000.exe twitch.exe deezer.exe tidal.exe audacity.exe`)
add('games', `steam.exe epicgameslauncher.exe riotclientservices.exe battle.net.exe galaxyclient.exe
  eadesktop.exe upc.exe ubisoftconnect.exe playnite.desktopapp.exe`)

/** Game launchers are "games" category, but not games themselves. */
const LAUNCHERS = new Set([
  'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'riotclientservices.exe', 'riotclientux.exe',
  'battle.net.exe', 'galaxyclient.exe', 'eadesktop.exe', 'upc.exe', 'ubisoftconnect.exe', 'crashreporter.exe',
  'unitycrashhandler64.exe', 'easyanticheat.exe', 'battleye.exe'
])

const GAME_PATH_MARKERS = [
  '\\steamapps\\common\\', '\\epic games\\', '\\riot games\\', '\\gog galaxy\\games\\', '\\gog games\\',
  '\\ubisoft game launcher\\games\\', '\\ea games\\', '\\xboxgames\\', '\\battle.net\\games\\',
  '\\world of warcraft\\', '\\overwatch\\', '\\hoyoplay\\games\\', '\\genshin impact\\', '\\minecraft launcher\\'
]

const GAME_EXES = new Set([
  'robloxplayerbeta.exe', 'league of legends.exe', 'valorant-win64-shipping.exe', 'cs2.exe', 'dota2.exe',
  'genshinimpact.exe', 'fortniteclient-win64-shipping.exe', 'r5apex.exe', 'overwatch.exe', 'osu!.exe',
  'terraria.exe', 'among us.exe', 'rocketleague.exe', 'destiny2.exe', 'eldenring.exe', 'gta5.exe', 'rdr2.exe',
  'witcher3.exe', 'cyberpunk2077.exe', 'bg3.exe', 'bg3_dx11.exe', 'minecraft.windows.exe', 'hollow_knight.exe',
  'stardew valley.exe', 'factorio.exe', 'rust.exe', 'pubg.exe', 'tslgame.exe', 'wow.exe', 'hearthstone.exe',
  'starrail.exe', 'zenlesszonezero.exe', 'deadlock.exe', 'marvel-win64-shipping.exe', 'helldivers2.exe'
])

export function looksLikeGame(exeName: string, exePath: string): boolean {
  const exe = exeName.toLowerCase()
  if (LAUNCHERS.has(exe)) return false
  if (GAME_EXES.has(exe)) return true
  const path = exePath.toLowerCase()
  return GAME_PATH_MARKERS.some((m) => path.includes(m))
}

export function guessCategoryKey(exeName: string, isGame: boolean): CategoryKey {
  if (isGame) return 'games'
  return EXE_CATEGORY[exeName.toLowerCase()] ?? 'other'
}

/** "Code.exe" → "Code", "sublime_text.exe" → "Sublime text" */
export function prettifyExeName(exeName: string): string {
  const base = exeName.replace(/\.exe$/i, '').replace(/[_-]+/g, ' ').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : exeName
}
