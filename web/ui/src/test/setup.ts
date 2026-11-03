import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// jsdom has no matchMedia. Primer asks it for the system colour scheme, so tests
// get a light system with no reduced-motion preference.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })
}

// jsdom has no constructable style sheets. Primer's popover polyfill adds its
// styles through them, so tests give documents and shadow roots an empty list.
for (const target of [globalThis.Document?.prototype, globalThis.ShadowRoot?.prototype]) {
  if (target !== undefined && !('adoptedStyleSheets' in target)) {
    Object.defineProperty(target, 'adoptedStyleSheets', { value: [], writable: true })
  }
}
