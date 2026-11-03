// The admin entry. It is built as its own page, admin/index.html, so the server
// can give it a stricter policy than the public pages, and so the public bundle
// never carries admin code.

import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@primer/primitives/dist/css/primitives.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import '../styles/tint.css'
import '../styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AdminApp } from './AdminApp'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('the page has no #root element')
}
createRoot(root).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
)
