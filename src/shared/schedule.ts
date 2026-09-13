import type { ActivitySession, ID } from './types'
import { MINUTE, SECOND } from './time'

/** A readable stretch of the day: "10:05–11:40 VS Code". */
export interface AgendaBlock {
  appId: ID
  categoryId: ID
  start: number
  end: number
  /** Time actually spent in the app within the block */
  activeMs: number
  /** Most-used window titles in the block */
  titles: { title: string; ms: number }[]
}

export interface AgendaOptions {
  from: number
  to: number
  /** Sessions shorter than this are treated as alt-tab noise and don't split blocks */
  noiseMs?: number
  /** Same-app sessions closer than this merge into one block */
  mergeGapMs?: number
  /** Blocks with less active time are dropped from the agenda */
  minBlockMs?: number
}

export function buildAgenda(sessions: ActivitySession[], opts: AgendaOptions): AgendaBlock[] {
  const { from, to, noiseMs = 30 * SECOND, mergeGapMs = 2 * MINUTE, minBlockMs = 2 * MINUTE } = opts
  const clipped = sessions
    .map((s) => ({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end - s.start >= noiseMs)
    .sort((a, b) => a.start - b.start)

  const blocks: (AgendaBlock & { titleMs: Map<string, number> })[] = []
  for (const s of clipped) {
    const ms = s.end - s.start
    let block = blocks[blocks.length - 1]
    const sameStretch =
      block && block.appId === s.appId && block.categoryId === s.categoryId && s.start - block.end <= mergeGapMs
    if (sameStretch) {
      block.end = Math.max(block.end, s.end)
      block.activeMs += ms
    } else {
      block = { appId: s.appId, categoryId: s.categoryId, start: s.start, end: s.end, activeMs: ms, titles: [], titleMs: new Map() }
      blocks.push(block)
    }
    if (s.title) block.titleMs.set(s.title, (block.titleMs.get(s.title) ?? 0) + ms)
  }

  return blocks
    .filter((b) => b.activeMs >= minBlockMs)
    .map(({ titleMs, ...b }) => ({
      ...b,
      titles: [...titleMs]
        .map(([title, ms]) => ({ title, ms }))
        .sort((x, y) => y.ms - x.ms)
        .slice(0, 5)
    }))
}
