// Code editors put the project name in the window title; this recovers it.

const VSCODE_LIKE = new Set(['code.exe', 'code - insiders.exe', 'code-insiders.exe', 'cursor.exe', 'windsurf.exe', 'vscodium.exe', 'zed.exe'])
const JETBRAINS = new Set([
  'idea64.exe', 'pycharm64.exe', 'webstorm64.exe', 'rider64.exe', 'clion64.exe', 'goland64.exe', 'phpstorm64.exe',
  'rustrover64.exe', 'datagrip64.exe', 'studio64.exe', 'fleet.exe'
])
const VISUAL_STUDIO = new Set(['devenv.exe'])

export const isCodeEditor = (exeName: string): boolean => {
  const exe = exeName.toLowerCase()
  return VSCODE_LIKE.has(exe) || JETBRAINS.has(exe) || VISUAL_STUDIO.has(exe)
}

const SEPARATOR = /\s+[—–-]\s+/

/**
 * "main.ts - timehub - Visual Studio Code" → "timehub"
 * "timehub – src/main.ts" (JetBrains) → "timehub"
 * "timehub - Microsoft Visual Studio" → "timehub"
 */
export function editorProject(exeName: string, title: string): string | null {
  const exe = exeName.toLowerCase()
  const parts = title
    .replace(/^[●•*]\s*/, '')
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  if (VSCODE_LIKE.has(exe)) {
    const last = parts[parts.length - 1].toLowerCase()
    const hasAppName = /visual studio code|code|cursor|windsurf|vscodium|zed/.test(last)
    const rest = hasAppName ? parts.slice(0, -1) : parts
    if (rest.length < 2) return null
    const project = rest[rest.length - 1]
    // "[Extension Development Host]" and similar decorations
    return project.replace(/\s*\[.*\]$/, '') || null
  }
  if (JETBRAINS.has(exe)) return parts[0] || null
  if (VISUAL_STUDIO.has(exe)) return /visual studio/i.test(parts[parts.length - 1]) ? parts[0] : null
  return null
}
