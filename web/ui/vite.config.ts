import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In development, Gatus runs on :8080 and Vite forwards its API to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8081,
    proxy: {
      '/api': 'http://localhost:8080',
      '/feed': 'http://localhost:8080',
      '/css/custom.css': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    restoreMocks: true,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    // Primer imports its own CSS, which Node cannot load, so Vitest processes it.
    server: { deps: { inline: [/@primer\/react/] } },
  },
})
