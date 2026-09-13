import type { TimehubApi } from '../shared/api'

declare global {
  interface Window {
    /** Set by the preload script inside Electron; undefined in the browser demo. */
    api?: TimehubApi
  }
}

export {}
