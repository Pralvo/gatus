// Renders the admin app at an address, signed in or out, with a fresh cache
// and the clock at 2 Nov 2026, 14:02 UTC, so check times read as a story.

import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { at } from '../../test/fixtures'
import { AdminApp } from '../AdminApp'
import { tokenKey } from '../session/token'

import { goodToken } from './server'

export interface RenderOptions {
  signedIn?: boolean
}

/** jsdom has no ResizeObserver; Primer's layout watches for overflow with one. */
class NoResizeObserver {
  observe(): void {
    // Nothing is measured in jsdom.
  }

  unobserve(): void {
    // Nothing was observed.
  }

  disconnect(): void {
    // Nothing was observed.
  }
}

export function renderAdmin(path = '/', { signedIn = true }: RenderOptions = {}) {
  if (typeof globalThis.ResizeObserver !== 'function') {
    vi.stubGlobal('ResizeObserver', NoResizeObserver)
  }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at(62))
  if (signedIn) {
    sessionStorage.setItem(tokenKey, goodToken)
  }
  window.history.pushState({}, '', path === '/' ? '/admin' : `/admin${path}`)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()
  const view = render(<AdminApp queryClient={queryClient} />)
  return { user, queryClient, ...view }
}

/** Resets everything a test may have left behind. */
export function cleanUpAdmin(): void {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
  window.history.pushState({}, '', '/')
}
