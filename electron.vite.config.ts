import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

/**
 * Strict CSP for production builds only: in dev, the React Refresh preamble
 * is an inline script that a meta CSP would block.
 */
const productionCsp = (): Plugin => ({
  name: 'timehub-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: timehub-media:; media-src 'self' blob: timehub-media:; font-src 'self' data:"
      },
      injectTo: 'head-prepend'
    }
  ]
})

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias }
  },
  preload: {
    resolve: { alias: sharedAlias }
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react(), productionCsp()]
  }
})
