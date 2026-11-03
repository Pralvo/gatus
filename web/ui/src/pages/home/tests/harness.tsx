// A fake Gatus for the home page tests: every API route the page calls,
// answered from an estate the test describes, and the browser-check pages.

import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, type Mock } from 'vitest'

import type { MaintenanceWindow, Report } from '../../../api/plugins/types'
import type { EndpointStatus, StatusEvent } from '../../../api/types'
import { App } from '../../../app/App'
import { defaultPageConfig, type PageConfig } from '../../../config/pageConfig'
import { at, event, results } from '../../../test/fixtures'

export interface Estate {
  statuses: EndpointStatus[]
  events?: Record<string, StatusEvent[]>
  reports?: Report[]
  windows?: MaintenanceWindow[]
  /** Paths that answer 500. */
  failing?: Set<string>
  /** Paths that never answer. */
  hanging?: Set<string>
  /** Browser-check pages the visitor cannot reach. */
  unreachable?: Set<string>
}

/** Five services in two groups, every check passing every 5 minutes up to minute 60. */
export function pralvoEstate(failing: Record<string, number[]> = {}): Estate {
  const service = (key: string, name: string, group: string): EndpointStatus => ({
    key,
    name,
    group,
    results: results(12, { last: 60, failing: new Map(Object.entries(failing)).get(key) ?? [] }),
  })
  const statuses = [
    service('website', 'Website', 'Public site'),
    service('blog', 'Blog', 'Public site'),
    service('content', 'Content system', 'Supporting services'),
    service('media', 'Media', 'Supporting services'),
    service('database', 'Database', 'Supporting services'),
  ]
  return {
    statuses,
    events: Object.fromEntries(
      statuses.map((status) => [status.key, [event('START', -60 * 24 * 20)]]),
    ),
  }
}

export const pralvoConfig: PageConfig = {
  ...defaultPageConfig,
  header: 'Pralvo status',
  defaultSortBy: 'group',
  sourceLink: 'https://github.com/Pralvo/gatus',
  feeds: true,
  checksLocation: 'one location in India',
  browserChecks: [
    { name: 'Website', link: 'https://pralvo.com/' },
    { name: 'Blog', link: 'https://pralvo.com/blog/' },
    { name: 'The image store', link: 'https://media.pralvo.com/' },
  ],
}

const iso = (ms: number) => new Date(ms).toISOString()

function reportJson(report: Report) {
  return {
    ...report,
    publishedAt: iso(report.publishedAt),
    updatedAt: iso(report.updatedAt),
    ...(report.resolvedAt === undefined ? {} : { resolvedAt: iso(report.resolvedAt) }),
    updates: report.updates.map((update) => ({ ...update, at: iso(update.at) })),
  }
}

function windowJson(window: MaintenanceWindow) {
  return { ...window, start: iso(window.start), end: iso(window.end) }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Answers for one service's events and history, and for single reports. */
function keyedAnswer(estate: Estate, path: string): Response | null {
  const keyed = /^\/api\/v1\/endpoints\/([^/]+)\/(statuses|response-times\/7d\/history)$/.exec(path)
  if (keyed !== null) {
    const key = decodeURIComponent(keyed[1] ?? '')
    const events = new Map(Object.entries(estate.events ?? {})).get(key) ?? []
    return keyed[2] === 'statuses'
      ? json({ key, results: [], events })
      : json({ timestamps: [1, 2, 3], values: [70, 70, 70] })
  }
  const reportId = /^\/api\/v1\/reports\/([^/]+)$/.exec(path)
  if (reportId !== null) {
    const found = estate.reports?.find((report) => report.id === reportId[1])
    return found === undefined ? json({}, 404) : json(reportJson(found))
  }
  return null
}

function answer(estate: Estate, path: string): Response {
  if (estate.failing?.has(path) === true) {
    return json({ error: 'broken' }, 500)
  }
  const keyed = keyedAnswer(estate, path)
  if (keyed !== null) {
    return keyed
  }
  switch (path) {
    case '/api/v1/endpoints/statuses':
      return json(estate.statuses)
    case '/api/v1/reports':
      return json({ reports: (estate.reports ?? []).map(reportJson), page: 1, more: false })
    case '/api/v1/maintenance':
      return json({ windows: (estate.windows ?? []).map(windowJson) })
    case '/api/v1/config':
      return json({ oidc: false, authenticated: false, announcements: [] })
    default:
      return json({}, 404)
  }
}

/** Answers every request from the estate; the estate may be changed between requests. */
export function serve(estate: Estate): Mock {
  const mock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://status.test')
    if (url.origin !== 'http://status.test') {
      const page = `${url.origin}${url.pathname}`
      return estate.unreachable?.has(page) === true
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response(null, { status: 200 }))
    }
    if (estate.hanging?.has(url.pathname) === true) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    }
    return Promise.resolve(answer(estate, url.pathname))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** Sets the page's clock: Date only, so timers and promises still run. */
export function setNow(ms: number = at(61)): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(ms)
}

/** Renders the whole app at an address, as a visitor would land on it. */
export function renderHome(path = '/', config: PageConfig = pralvoConfig) {
  window.history.pushState({}, '', path)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = userEvent.setup()
  render(<App config={config} queryClient={client} />)
  return { user, client }
}

/** The paths requested so far, without origins or queries. */
export function requested(mock: Mock): string[] {
  return mock.mock.calls.map(([input]) => {
    const url = new URL(String(input), 'http://status.test')
    return url.origin === 'http://status.test' ? url.pathname : `${url.origin}${url.pathname}`
  })
}
