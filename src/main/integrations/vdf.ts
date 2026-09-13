// Valve KeyValues ("VDF") text format used by Steam's config files.

export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

export function parseVdf(text: string): VdfObject {
  let i = 0
  const n = text.length

  const skip = (): void => {
    while (i < n) {
      const c = text[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿') i++
      else if (c === '/' && text[i + 1] === '/') while (i < n && text[i] !== '\n') i++
      else break
    }
  }

  const readString = (): string => {
    if (text[i] === '"') {
      i++
      let s = ''
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1]
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e
          i += 2
        } else {
          s += text[i++]
        }
      }
      i++
      return s
    }
    let s = ''
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++]
    return s
  }

  const readObject = (): VdfObject => {
    const obj: VdfObject = {}
    for (;;) {
      skip()
      if (i >= n) return obj
      if (text[i] === '}') {
        i++
        return obj
      }
      const key = readString()
      skip()
      if (text[i] === '{') {
        i++
        obj[key] = readObject()
      } else {
        obj[key] = readString()
      }
    }
  }

  return readObject()
}

/** Case-insensitive path lookup (Steam isn't consistent about key casing). */
export function vdfGet(value: VdfValue | undefined, ...path: string[]): VdfValue | undefined {
  let cur: VdfValue | undefined = value
  for (const part of path) {
    if (!cur || typeof cur !== 'object') return undefined
    const key: string | undefined = Object.keys(cur).find((k) => k.toLowerCase() === part.toLowerCase())
    cur = key === undefined ? undefined : cur[key]
  }
  return cur
}

export const vdfObject = (v: VdfValue | undefined): VdfObject => (v && typeof v === 'object' ? v : {})
export const vdfString = (v: VdfValue | undefined): string | undefined => (typeof v === 'string' ? v : undefined)
