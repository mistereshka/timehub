import { describe, expect, it } from 'vitest'
import { pixelIcon, pixelIcons } from './pixelIcons'

describe('pixel icons', () => {
  it('draws a set of different icons, the same every time', () => {
    const icons = pixelIcons()
    expect(icons.length).toBeGreaterThanOrEqual(40)
    expect(new Set(icons.map((i) => i.key)).size).toBe(icons.length)
    expect(new Set(icons.map((i) => i.url)).size).toBe(icons.length)
    expect(icons.every((i) => i.key.startsWith('pixel:') && i.url.startsWith('data:image/svg+xml,'))).toBe(true)
    expect(pixelIcon('pixel:sunset')).toBe(icons.find((i) => i.key === 'pixel:sunset')!.url)
    expect(pixelIcon('pixel:nope')).toBeNull()
  })
})
