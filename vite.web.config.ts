// Demo mode: serves the renderer in a plain browser with an in-memory mock API.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  build: { outDir: resolve(__dirname, 'out/web'), emptyOutDir: true }
})
