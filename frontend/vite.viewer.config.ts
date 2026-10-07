import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The public viewer (src/viewer) — a second app built from the same sources as
// the collector UI, sharing its theme and components. Output: dist-viewer/.
// Dev: run the fingrid-viewer binary on :3002, then `npm run dev:viewer`.
export default defineConfig({
  plugins: [react()],
  root: 'viewer',
  base: './',
  build: {
    outDir: '../dist-viewer',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
})
