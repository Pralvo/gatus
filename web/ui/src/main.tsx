import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@primer/primitives/dist/css/primitives.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './styles/tint.css'
import './styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { readPageConfig } from './config/pageConfig'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('the page has no #root element')
}
createRoot(root).render(
  <StrictMode>
    <App config={readPageConfig()} />
  </StrictMode>,
)
