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

/** A stretch on the day timeline: one app, or several short ones shown together. */
export interface TimelineBlock {
  start: number
  end: number
  /** The app with the most time in the stretch */
  appId: ID
  categoryId: ID
  activeMs: number
  /** Apps in the stretch, most used first (a single entry for a plain block) */
  apps: { appId: ID; categoryId: ID; ms: number }[]
  /** Window titles — only when the stretch is a single app */
  titles: { title: string; ms: number }[]
}

function mergeTitles(group: AgendaBlock[]): { title: string; ms: number }[] {
  const byTitle = new Map<string, number>()
  for (const b of group) for (const x of b.titles) byTitle.set(x.title, (byTitle.get(x.title) ?? 0) + x.ms)
  return [...byTitle]
    .map(([title, ms]) => ({ title, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
}

/**
 * Quick alt-tabs make blocks too thin to read (a stack of 2-pixel stripes).
 * Consecutive short blocks are grouped until the group spans `minSpanMs`; it is
 * shown as its most-used app "+N" and lists every app on hover. Blocks that are
 * long enough on their own stay as they are.
 */
export function groupShortBlocks(blocks: AgendaBlock[], minSpanMs: number, maxGapMs = 2 * MINUTE): TimelineBlock[] {
  const out: TimelineBlock[] = []
  let group: AgendaBlock[] = []
  const flush = (): void => {
    if (!group.length) return
    const perApp = new Map<ID, { appId: ID; categoryId: ID; ms: number }>()
    for (const b of group) {
      const cur = perApp.get(b.appId) ?? { appId: b.appId, categoryId: b.categoryId, ms: 0 }
      cur.ms += b.activeMs
      perApp.set(b.appId, cur)
    }
    const apps = [...perApp.values()].sort((a, b) => b.ms - a.ms)
    out.push({
      start: group[0].start,
      end: Math.max(...group.map((b) => b.end)),
      appId: apps[0].appId,
      categoryId: apps[0].categoryId,
      activeMs: apps.reduce((s, a) => s + a.ms, 0),
      apps,
      titles: apps.length === 1 ? mergeTitles(group) : []
    })
    group = []
  }
  for (const b of blocks) {
    const long = b.end - b.start >= minSpanMs
    const last = group[group.length - 1]
    if (long || (last && b.start - last.end > maxGapMs)) flush()
    group.push(b)
    if (long || b.end - group[0].start >= minSpanMs) flush()
  }
  flush()
  return out
}
