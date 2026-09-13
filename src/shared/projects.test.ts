import { describe, expect, it } from 'vitest'
import { editorProject } from './projects'
import { currentStreak, longestStreak } from './streak'

describe('editor projects', () => {
  it('reads the project from editor window titles', () => {
    expect(editorProject('Code.exe', 'service.ts - timehub - Visual Studio Code')).toBe('timehub')
    expect(editorProject('Code.exe', '● main.ts - api [WSL: Ubuntu] - Visual Studio Code')).toBe('api')
    expect(editorProject('Cursor.exe', 'App.tsx — shop — Cursor')).toBe('shop')
    expect(editorProject('idea64.exe', 'backend – UserService.kt')).toBe('backend')
    expect(editorProject('devenv.exe', 'Game - Microsoft Visual Studio')).toBe('Game')
    expect(editorProject('Code.exe', 'Welcome - Visual Studio Code')).toBeNull()
    expect(editorProject('chrome.exe', 'a - b - c')).toBeNull()
  })
})

describe('streak helpers', () => {
  it('counts current and longest runs', () => {
    const days = new Set(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-01', '2026-09-02'])
    expect(currentStreak(days, '2026-09-13')).toBe(3)
    expect(currentStreak(days, '2026-09-12')).toBe(3)
    expect(currentStreak(days, '2026-09-15')).toBe(0)
    expect(longestStreak(days)).toBe(3)
  })
})
