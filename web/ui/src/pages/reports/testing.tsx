// Test helpers for the report pages: a fake server answering by URL, a fixed
// clock (only Date is faked, so React Query's timers run normally), and the
// whole app rendered at an address.

import { QueryClient } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'

import type { Report } from '../../api/plugins/types'
import type { StatusEvent } from '../../api/types'
import { App } from '../../app/App'
import { defaultPageConfig, type PageConfig } from '../../config/pageConfig'
import { at, event, report } from '../../test/fixtures'

/** 2 Nov 2026, 14:30 UTC. */
export const now = at(90)

export const pralvo: PageConfig = {
  ...defaultPageConfig,
  header: 'Pralvo status',
  feeds: true,
}

let answers = new Map<string, { status: number; body: string }>()

/** Makes the fake server answer `url` with `body`. */
export function answer(url: string, body: unknown, status = 200): void {
  answers.set(url, { status, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

/** Every URL fetched so far. */
export function fetched(): string[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => String(url))
}

export function startServer(): void {
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const found = answers.get(url) ?? { status: 404, body: '{}' }
      return Promise.resolve(new Response(found.body, { status: found.status }))
    }),
  )
}

export function stopServer(): void {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
}

const iso = (ms: number) => new Date(ms).toISOString()

/** A report as the server sends it. */
export function wire(item: Report): unknown {
  return {
    ...item,
    updates: item.updates.map((update) => ({ ...update, at: iso(update.at) })),
    publishedAt: iso(item.publishedAt),
    updatedAt: iso(item.updatedAt),
    ...(item.resolvedAt === undefined ? {} : { resolvedAt: iso(item.resolvedAt) }),
  }
}

/** Answers a service's events call. */
export function answerEvents(key: string, events: StatusEvent[], status = 200): void {
  answer(
    `/api/v1/endpoints/${key}/statuses?page=1&pageSize=1`,
    { key, results: [], events },
    status,
  )
}

/** Renders the app at `path` with a fresh cache. */
export function renderAt(path: string, config: PageConfig = pralvo): RenderResult {
  window.history.pushState({}, '', path)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  return render(<App config={config} queryClient={client} />)
}

/** The spec's example: published 13:44, resolved 14:20, four updates. */
export const resolved = report({
  stage: 'resolved',
  updates: [
    { stage: 'resolved', at: at(80), message: 'Images have loaded normally for 20 minutes.' },
    { stage: 'monitoring', at: at(58), message: 'Images load normally again.' },
    { stage: 'identified', at: at(51), message: 'Images are answering slowly.' },
    { stage: 'investigating', at: at(44), message: 'Some images are loading slowly.' },
  ],
  resolvedAt: at(80),
  updatedAt: at(80),
})

/** Media failed from 13:40 to 14:02. */
export const mediaFailed = [event('START', -500), event('UNHEALTHY', 40), event('HEALTHY', 62)]
