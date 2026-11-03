// A fake Gatus for the service and flow pages: the home page's estate, plus
// each service's result pages, response-time history, uptime and flows.

import { vi, type Mock } from 'vitest'

import type { ResponseTimeHistory, Result, SuiteStatus } from '../../../api/types'
import { inOrder } from '../../../domain/status/trend'
import { hourMs } from '../../../domain/time/format'
import { at } from '../../../test/fixtures'
import { serve, type Estate } from '../../home/tests/harness'

export interface Extras {
  /** Each service's kept results for the result pages; its list results when left out. */
  pages?: Record<string, Result[]>
  /** History by "key window", such as "media 24h"; 48 hours of 70 ms when left out. */
  histories?: Record<string, ResponseTimeHistory>
  /** 30-day uptime by key; 0.995 when left out. */
  uptimes?: Record<string, number>
  flows?: SuiteStatus[]
  /** Paths, with their query, that answer 500. */
  broken?: Set<string>
}

/** 48 hourly averages of 70 ms, the newest at minute 0. */
export function steadyHistory(ms = 70, hours = 48): ResponseTimeHistory {
  return {
    timestamps: Array.from({ length: hours }, (_, index) => at(0) - (hours - 1 - index) * hourMs),
    values: Array.from({ length: hours }, () => ms),
  }
}

function text(body: string, status = 200): Response {
  return new Response(body, { status })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function keyOf(estate: Estate, raw: string | undefined): string | null {
  const key = decodeURIComponent(raw ?? '')
  return estate.statuses.some((status) => status.key === key) ? key : null
}

/** A page of results, newest page first, each page oldest first as Gatus sends it. */
function resultPage(estate: Estate, extras: Extras, key: string, url: URL): Response {
  const page = Number(url.searchParams.get('page') ?? '1')
  const size = Number(url.searchParams.get('pageSize') ?? '50')
  const all =
    new Map(Object.entries(extras.pages ?? {})).get(key) ??
    estate.statuses.find((status) => status.key === key)?.results ??
    []
  const ordered = inOrder(all)
  const end = ordered.length - (page - 1) * size
  const results = end <= 0 ? [] : ordered.slice(Math.max(0, end - size), end)
  return json({ key, results, events: [] })
}

function suiteAnswer(extras: Extras, path: string): Response | null {
  const suite = /^\/api\/v1\/suites\/([^/]+)\/statuses$/.exec(path)
  if (suite === null) {
    return null
  }
  const found = extras.flows?.find((flow) => flow.key === decodeURIComponent(suite[1] ?? ''))
  return found === undefined ? json({ error: 'not found' }, 404) : json(found)
}

function endpointAnswer(estate: Estate, extras: Extras, url: URL): Response | null {
  const keyed = /^\/api\/v1\/endpoints\/([^/]+)\/(.+)$/.exec(url.pathname)
  if (keyed === null) {
    return null
  }
  const key = keyOf(estate, keyed[1])
  if (key === null) {
    return text('endpoint not found', 404)
  }
  const rest = keyed[2] ?? ''
  if (rest === 'statuses' && url.searchParams.get('pageSize') === '50') {
    return resultPage(estate, extras, key, url)
  }
  const history = /^response-times\/(24h|7d|30d)\/history$/.exec(rest)
  if (history !== null) {
    const found = new Map(Object.entries(extras.histories ?? {})).get(`${key} ${history[1] ?? ''}`)
    return json(found ?? steadyHistory())
  }
  if (rest === 'uptimes/30d') {
    return text(String(new Map(Object.entries(extras.uptimes ?? {})).get(key) ?? 0.995))
  }
  return null
}

function extraAnswer(estate: Estate, extras: Extras, url: URL): Response | null {
  const path = url.pathname
  if (extras.broken?.has(`${path}${url.search}`) === true || extras.broken?.has(path) === true) {
    return json({ error: 'broken' }, 500)
  }
  return suiteAnswer(extras, path) ?? endpointAnswer(estate, extras, url)
}

/** Answers the service and flow pages' requests, falling back to the home page's fake Gatus. */
export function serveService(estate: Estate, extras: Extras = {}): Mock {
  const home = serve(estate)
  const mock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://status.test')
    const answer = extraAnswer(estate, extras, url)
    return answer === null ? home(input, init) : Promise.resolve(answer)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
