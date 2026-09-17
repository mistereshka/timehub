/**
 * Minecraft-style pixel art for instance icons, drawn in code (16×16): blocks, ores, little scenes and
 * items. Every icon is seeded by its key, so it looks the same on every run.
 */

type Grid = string[][]
const N = 16

export const PIXEL_PREFIX = 'pixel:'

export interface PixelIcon {
  key: string
  url: string
}

function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

type Rand = () => number
const blank = (color = ''): Grid => Array.from({ length: N }, () => Array<string>(N).fill(color))
const pick = <T>(rand: Rand, list: T[]): T => list[Math.floor(rand() * list.length)]
const at = (rand: Rand, max: number): number => Math.floor(rand() * max)

// Shades repeat the main colour so it dominates, like on real block textures.
const STONE = ['#7f7f7f', '#7f7f7f', '#8a8a8a', '#747474', '#6b6b6b']
const DIRT = ['#8b5a2b', '#8b5a2b', '#7a4f25', '#99663a', '#6c4520']
const GRASS = ['#5f9f35', '#5f9f35', '#6fb33f', '#528c2c', '#7cc24a']
const SNOW = ['#f4f8ff', '#ffffff', '#e6eef8', '#f4f8ff']
const SAND = ['#dcd39f', '#dcd39f', '#e6ddae', '#cfc58f', '#d4ca95']
const LEAVES = ['#3f7d1f', '#4d9426', '#2f6317', '#5aa82e', '#3f7d1f']
const WATER = ['#3f76e4', '#3f76e4', '#3b6fd8', '#4a82ee', '#355fbf']
const LAVA = ['#e0600f', '#f28a1a', '#ffb52e', '#c2410c', '#f28a1a']
const NETHERRACK = ['#6f2a2a', '#7d3131', '#5c2222', '#8a3a3a']
const OBSIDIAN = ['#140f1f', '#1d1530', '#281d40', '#140f1f', '#3a2a5c']
const END_STONE = ['#dbdca0', '#e5e6ae', '#cfd092', '#c7c888']
const AMETHYST = ['#8d5fd3', '#a374e8', '#7449b8', '#b58cf5', '#8d5fd3']
const ITEM_BG = ['#221c33', '#282040', '#1f1a2e', '#221c33']

/** Every pixel a random shade — the look of any Minecraft block. */
function noisy(grid: Grid, shades: string[], rand: Rand, from = 0, to = N): Grid {
  for (let y = from; y < to; y++) for (let x = 0; x < N; x++) grid[y][x] = pick(rand, shades)
  return grid
}

/** Horizontal colour bands from top to bottom — skies. */
function bands(grid: Grid, colors: string[], from: number, to: number): void {
  for (let y = from; y < to; y++) grid[y].fill(colors[Math.floor(((y - from) * colors.length) / (to - from))])
}

function square(grid: Grid, x: number, y: number, size: number, color: string): void {
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) grid[y + dy][x + dx] = color
}

/** A blocky skyline: columns two pixels wide that step up and down. */
function hills(grid: Grid, rand: Rand, level: number, fill: (rand: Rand) => string, top?: string): void {
  let h = level
  for (let x = 0; x < N; x += 2) {
    h = Math.max(level - 3, Math.min(level + 2, h + at(rand, 3) - 1))
    for (let y = h; y < N; y++) {
      for (const xx of [x, x + 1]) grid[y][xx] = y === h && top ? top : fill(rand)
    }
  }
}

// ---------------------------------------------------------------- blocks

function topBlock(rand: Rand, top: string[]): Grid {
  const g = noisy(blank(), DIRT, rand)
  noisy(g, top, rand, 0, 3)
  // the top layer hangs down unevenly
  for (let x = 0; x < N; x++) {
    if (rand() < 0.55) g[3][x] = pick(rand, top)
    if (g[3][x] !== '' && top.includes(g[3][x]) && rand() < 0.3) g[4][x] = pick(rand, top)
  }
  return g
}

function cobblestone(rand: Rand): Grid {
  const g = noisy(blank(), ['#5f5f5f', '#646464'], rand)
  for (let k = 0; k < 14; k++) {
    const x = at(rand, 13)
    const y = at(rand, 14)
    const w = 2 + at(rand, 2)
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < w; dx++) g[y + dy][x + dx] = pick(rand, ['#8f8f8f', '#9a9a9a', '#858585'])
  }
  return g
}

function planks(rand: Rand, shades: string[], line: string): Grid {
  const g = noisy(blank(), shades, rand)
  for (let y = 3; y < N; y += 4) g[y].fill(line)
  // seams between boards, staggered row by row
  for (let row = 0; row < 4; row++) {
    const x = row % 2 ? 4 : 11
    for (let y = row * 4; y < row * 4 + 3; y++) g[y][x] = line
  }
  return g
}

function log(rand: Rand, bark: string[]): Grid {
  const g = blank()
  for (let x = 0; x < N; x++) {
    const base = x % 3 === 0 ? bark[2] : bark[0]
    for (let y = 0; y < N; y++) g[y][x] = rand() < 0.25 ? pick(rand, bark) : base
  }
  return g
}

function water(rand: Rand): Grid {
  const g = noisy(blank(), WATER, rand)
  for (let y = 2; y < N; y += 4) {
    for (let x = at(rand, 4); x < N - 2; x += 6) {
      g[y][x] = '#7fb0ff'
      g[y][x + 1] = '#7fb0ff'
      g[y - 1][x + 2] = '#9cc4ff'
    }
  }
  return g
}

function ore(rand: Rand, light: string, dark: string): Grid {
  const g = noisy(blank(), STONE, rand)
  for (let k = 0; k < 5; k++) {
    const cx = 1 + at(rand, 13)
    const cy = 1 + at(rand, 13)
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (rand() < 0.8) g[cy + dy][cx + dx] = rand() < 0.35 ? light : dark
    }
  }
  return g
}

// ---------------------------------------------------------------- scenes

function sunset(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#2a1b4d', '#4b2466', '#86306e', '#c8465f', '#ee7a4a', '#f7ae52'], 0, 13)
  square(g, 6, 5, 4, '#ffe39a')
  hills(g, rand, 12, (r) => pick(r, ['#1b1230', '#211636']), '#2f2050')
  return g
}

function night(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#060a1c', '#0b1230', '#111b45', '#18255a'], 0, N)
  for (let k = 0; k < 14; k++) g[at(rand, 10)][at(rand, N)] = rand() < 0.3 ? '#ffe9a8' : '#ffffff'
  square(g, 10, 2, 3, '#f1efd8')
  g[3][11] = '#cfccb0'
  hills(g, rand, 12, (r) => pick(r, ['#0d1a14', '#10201a']), '#1d3a2a')
  return g
}

function tree(g: Grid, rand: Rand, x: number, ground: number): void {
  const trunkTop = ground - 3 - at(rand, 2)
  for (let y = trunkTop; y < ground; y++) g[y][x + 1] = '#6b4a2b'
  for (let y = trunkTop - 3; y <= trunkTop; y++) {
    for (let xx = x - 1; xx <= x + 3; xx++) {
      const corner = y === trunkTop - 3 && (xx === x - 1 || xx === x + 3)
      if (xx >= 0 && xx < N && !corner) g[y][xx] = pick(rand, LEAVES)
    }
  }
}

function forest(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#7fb8ff', '#96c7ff', '#b2d8ff'], 0, 12)
  noisy(g, GRASS, rand, 12, 13)
  noisy(g, DIRT, rand, 13, N)
  for (const x of [1, 7, 12]) tree(g, rand, x, 12)
  return g
}

function ocean(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#ff9e6b', '#ffc08a', '#ffe2a8', '#cfe6ff'], 0, 8)
  square(g, 3, 4, 3, '#fff3c4')
  noisy(g, WATER, rand, 8, N)
  for (let k = 0; k < 10; k++) g[8 + at(rand, 8)][at(rand, N)] = '#9cc4ff'
  // the sun's path on the water
  for (let y = 8; y < N; y += 2) g[y][4] = '#ffe9a8'
  return g
}

function cave(rand: Rand): Grid {
  const g = noisy(blank(), ['#3a3a3a', '#333333', '#2b2b2b', '#404040'], rand)
  for (let y = 4; y < 13; y++) {
    for (let x = 2; x < 14; x++) if ((x - 8) ** 2 / 30 + (y - 8.5) ** 2 / 16 < 1) g[y][x] = pick(rand, ['#141414', '#1a1a1a'])
  }
  for (const c of ['#5decf5', '#fcee4b', '#ff3b3b']) {
    g[at(rand, 3)][at(rand, N)] = c
    g[13 + at(rand, 3)][at(rand, N)] = c
  }
  // a torch on the wall
  g[6][4] = '#ff9a1f'
  g[7][4] = '#ffd34d'
  g[8][4] = '#7a5a36'
  g[9][4] = '#7a5a36'
  return g
}

function nether(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#2a0707', '#3d0b0b', '#551313'], 0, 12)
  for (let k = 0; k < 6; k++) g[at(rand, 8)][at(rand, N)] = '#7a2a1a'
  hills(g, rand, 10, (r) => pick(r, NETHERRACK), '#9a4040')
  noisy(g, LAVA, rand, 14, N)
  return g
}

function theEnd(rand: Rand): Grid {
  const g = blank('#07040f')
  for (let k = 0; k < 12; k++) g[at(rand, 9)][at(rand, N)] = pick(rand, ['#e7d6ff', '#ffffff', '#b99cff'])
  for (let y = 11; y < N; y++) {
    for (let x = 0; x < N; x++) if (Math.abs(x - 7.5) < 8 - (y - 11) * 1.6) g[y][x] = pick(rand, END_STONE)
  }
  for (let y = 4; y < 12; y++) for (const x of [11, 12]) g[y][x] = pick(rand, OBSIDIAN)
  g[3][11] = '#f0b3ff'
  g[3][12] = '#c77dff'
  return g
}

function desert(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#6fb6ff', '#8cc6ff', '#b5dcff', '#ffe7b0'], 0, 12)
  square(g, 11, 2, 3, '#fff4c2')
  hills(g, rand, 11, (r) => pick(r, SAND), '#efe7bd')
  for (let y = 5; y < 11; y++) g[y][4] = y % 2 ? '#3f8f3a' : '#2f7a2b'
  g[7][3] = '#3f8f3a'
  g[8][3] = '#3f8f3a'
  g[8][5] = '#3f8f3a'
  g[9][5] = '#3f8f3a'
  return g
}

function spruce(g: Grid, x: number, base: number): void {
  const halfWidths = [0, 1, 1, 2, 1, 2, 2, 3]
  halfWidths.forEach((w, i) => {
    const y = base - halfWidths.length + i
    for (let xx = x - w; xx <= x + w; xx++) if (xx >= 0 && xx < N) g[y][xx] = i % 2 ? '#1f4d33' : '#2a6040'
  })
  g[base - halfWidths.length][x] = '#ffffff'
  g[base][x] = '#5a3d24'
}

function snowy(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#a9c8e8', '#c3d8ee', '#dbe8f5'], 0, 13)
  for (let k = 0; k < 10; k++) g[at(rand, 10)][at(rand, N)] = '#ffffff'
  for (const x of [3, 11]) spruce(g, x, 11)
  hills(g, rand, 12, (r) => pick(r, SNOW), '#ffffff')
  return g
}

function cherry(rand: Rand): Grid {
  const g = blank()
  bands(g, ['#9fd3ff', '#b2dcff', '#c8e6ff'], 0, 12)
  noisy(g, GRASS, rand, 12, 13)
  noisy(g, DIRT, rand, 13, N)
  for (let y = 7; y < 12; y++) g[y][7] = '#4a2c2a'
  g[8][8] = '#4a2c2a'
  for (let y = 1; y < 8; y++) {
    for (let x = 2; x < 14; x++) if ((x - 7.5) ** 2 / 36 + (y - 4) ** 2 / 10 < 1) g[y][x] = pick(rand, ['#f7b6d2', '#f39ac3', '#fcd0e4', '#e882b4'])
  }
  for (let k = 0; k < 5; k++) g[8 + at(rand, 4)][at(rand, N)] = '#f7b6d2'
  return g
}

// ---------------------------------------------------------------- items

/** A small sprite, doubled, on a dark tile. `.` is empty. */
function item(rand: Rand, sprite: string[], colors: Record<string, string>): Grid {
  const g = noisy(blank(), ITEM_BG, rand)
  const ox = Math.floor((N - sprite[0].length * 2) / 2)
  const oy = Math.floor((N - sprite.length * 2) / 2)
  sprite.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = colors[ch]
      if (c) square(g, ox + x * 2, oy + y * 2, 2, c)
    })
  )
  return g
}

const HEART = ['.XX.XX.', 'XHXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']
const SWORD = ['......ss', '.....sws', '....sws.', '.g.sws..', '..gws...', '..hg....', '.h..g...', 'h.......']
const APPLE = ['....s...', '...sl...', '.rrrrrr.', 'rrwrrrrr', 'rwrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rr.rr.']
const TORCH = ['..yy..', '.yooy.', '..oo..', '..bb..', '..bb..', '..bb..', '..bb..']
const POTION = ['..cc..', '..gg..', '.g..g.', 'gppppg', 'gpwppg', 'gppppg', '.gggg.']
const GEM = ['.ddddd.', 'dwddddd', 'wdddddk', '.ddddk.', '..ddk..', '...d...']

// ---------------------------------------------------------------- the set

const DRAW: [name: string, draw: (rand: Rand) => Grid][] = [
  ['sunset', sunset],
  ['night', night],
  ['forest', forest],
  ['ocean', ocean],
  ['cave', cave],
  ['nether', nether],
  ['end', theEnd],
  ['desert', desert],
  ['snowy', snowy],
  ['cherry', cherry],
  ['grass', (r) => topBlock(r, GRASS)],
  ['snow-grass', (r) => topBlock(r, SNOW)],
  ['dirt', (r) => noisy(blank(), DIRT, r)],
  ['stone', (r) => noisy(blank(), STONE, r)],
  ['cobblestone', cobblestone],
  ['sand', (r) => noisy(blank(), SAND, r)],
  ['oak-planks', (r) => planks(r, ['#a2824e', '#9a7a47', '#ab8b56'], '#6e5431')],
  ['birch-planks', (r) => planks(r, ['#d7c78d', '#cfbf85', '#e0d096'], '#a8966a')],
  ['oak-log', (r) => log(r, ['#6b5132', '#5a4429', '#4a3820', '#7a5e3a'])],
  ['leaves', (r) => noisy(blank(), LEAVES, r)],
  ['water', water],
  ['lava', (r) => noisy(blank(), LAVA, r)],
  ['netherrack', (r) => noisy(blank(), NETHERRACK, r)],
  ['obsidian', (r) => noisy(blank(), OBSIDIAN, r)],
  ['end-stone', (r) => noisy(blank(), END_STONE, r)],
  ['amethyst', (r) => noisy(blank(), AMETHYST, r)],
  ['diamond-ore', (r) => ore(r, '#b5fbff', '#39c9d6')],
  ['emerald-ore', (r) => ore(r, '#8dffb4', '#17a34a')],
  ['gold-ore', (r) => ore(r, '#fff27a', '#d4a017')],
  ['redstone-ore', (r) => ore(r, '#ff6b6b', '#b30000')],
  ['lapis-ore', (r) => ore(r, '#6f8fff', '#1d3a99')],
  ['iron-ore', (r) => ore(r, '#f0d6c2', '#b08d77')],
  ['copper-ore', (r) => ore(r, '#ffa37a', '#a14f2e')],
  ['heart', (r) => item(r, HEART, { X: '#e3262f', H: '#ff8a8f' })],
  ['sword', (r) => item(r, SWORD, { s: '#39c9d6', w: '#d4fdff', g: '#8a6a2a', h: '#5a3d24' })],
  ['apple', (r) => item(r, APPLE, { r: '#d8262e', w: '#ff8a8a', s: '#5a3d24', l: '#3f9f35' })],
  ['torch', (r) => item(r, TORCH, { y: '#ffe14a', o: '#ff8a1f', b: '#7a5a36' })],
  ['potion', (r) => item(r, POTION, { c: '#8a6a3a', g: '#cfe6ff', p: '#b14cff', w: '#ecd2ff' })],
  ['healing-potion', (r) => item(r, POTION, { c: '#8a6a3a', g: '#cfe6ff', p: '#ff3b5c', w: '#ffc2cc' })],
  ['diamond', (r) => item(r, GEM, { d: '#5decf5', w: '#e0ffff', k: '#2bb8c4' })],
  ['emerald', (r) => item(r, GEM, { d: '#41f384', w: '#d2ffe0', k: '#17a34a' })]
]

/** Draws the grid as an SVG with one rect per run of equal pixels. */
function toUrl(grid: Grid): string {
  let rects = ''
  for (let y = 0; y < N; y++) {
    let x = 0
    while (x < N) {
      const color = grid[y][x]
      let w = 1
      while (x + w < N && grid[y][x + w] === color) w++
      if (color) rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${color}"/>`
      x += w
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

let icons: PixelIcon[] | null = null

export function pixelIcons(): PixelIcon[] {
  icons ??= DRAW.map(([name, draw]) => {
    const key = PIXEL_PREFIX + name
    return { key, url: toUrl(draw(random(hashString(key)))) }
  })
  return icons
}

export const pixelIcon = (key: string): string | null => pixelIcons().find((i) => i.key === key)?.url ?? null
