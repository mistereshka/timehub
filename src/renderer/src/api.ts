import type { TimehubApi } from '@shared/api'

let current: TimehubApi | null = null

/** Uses the Electron preload API, or boots the in-browser demo when it's missing. */
export async function initApi(): Promise<TimehubApi> {
  const resolved = window.api ?? (await (await import('./demo/demoHost')).createDemoApi())
  current = resolved
  return resolved
}

export const api: TimehubApi = new Proxy({} as TimehubApi, {
  get: (_target, key) => {
    if (!current) throw new Error('API used before initApi()')
    return current[key as keyof TimehubApi]
  }
})

/** Strips Electron's "Error invoking remote method …" wrapper from IPC errors. */
export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
