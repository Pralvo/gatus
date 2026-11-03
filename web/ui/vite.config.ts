import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// The server answers every /admin/{path...} with the admin page. In
// development, Vite would answer them with the public page, so send them to
// the admin page as the server does. Files under /admin keep their own paths.
const adminPages: Plugin = {
  name: 'pralvo-admin-pages',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const path = request.url?.split('?')[0] ?? ''
      if (path === '/admin' || (path.startsWith('/admin/') && !/\.[a-z0-9]+$/i.test(path))) {
        request.url = '/admin/index.html'
      }
      next()
    })
  },
}

// In development, Gatus runs on :8080 and Vite forwards its API to it.
// The build has two pages: the public app, and the admin at admin/index.html,
// which the server gives its own strict policy.
export default defineConfig({
  plugins: [react(), adminPages],
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
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin/index.html', import.meta.url)),
      },
    },
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
