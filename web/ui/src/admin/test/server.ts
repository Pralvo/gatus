// A fake server for admin tests: the incidents plugin's token API, with the
// same routes, JSON, error codes and state machine, and the public routes the
// admin reads. Tests stub fetch with it and read back every call it received.

import { vi } from 'vitest'

import type { EndpointStatus } from '../../api/types'
import { at } from '../../test/fixtures'

export const goodToken = 'good-token-0123456789'

type Raw = Record<string, unknown>

export interface Call {
  method: string
  path: string
  body: unknown
  authorization: string | null
}

export interface FakeOptions {
  reports?: Raw[]
  incidents?: Raw[]
  statuses?: EndpointStatus[]
  publicReports?: Raw[]
}

export interface FakeServer {
  calls: Call[]
  reports: Raw[]
  incidents: Raw[]
  /** The next admin request gets this answer instead, once. `network` fails it. */
  failNext: (status: number | 'network', body?: unknown) => void
  adminCalls: () => Call[]
}

// The plugin's own moves (plugins/incidents/record/rules.go), kept apart from
// the page's copy so a wrong move in the page is refused here as it would be.
const moves = new Map<string, string[]>([
  ['open', ['mitigated', 'resolved', 'cancelled']],
  ['mitigated', ['open', 'resolved', 'cancelled']],
  ['resolved', ['open', 'closed']],
  ['cancelled', ['open', 'closed']],
  ['closed', []],
])

const clock = new Date(at(62)).toISOString()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function refuse(status: number, error: string): Response {
  return json(status, { error, message: `refused: ${error}` })
}

export function adminReport(overrides: Raw = {}): Raw {
  return {
    id: 'a1b2',
    title: 'Some images fail to load',
    stage: 'investigating',
    endpoints: [],
    updates: [
      {
        seq: 1,
        at: new Date(at(44)).toISOString(),
        actor: 'alice',
        stage: 'investigating',
        message: 'We are looking into it.',
      },
    ],
    created_by: 'alice',
    created_at: new Date(at(44)).toISOString(),
    updated_at: new Date(at(44)).toISOString(),
    ...overrides,
  }
}

export function adminIncident(overrides: Raw = {}): Raw {
  return {
    id: 'i1',
    title: 'Image store errors',
    severity: 'major',
    state: 'open',
    created_by: 'alice',
    created_at: new Date(at(50)).toISOString(),
    updated_at: new Date(at(50)).toISOString(),
    timeline: [{ seq: 1, at: new Date(at(50)).toISOString(), actor: 'alice', kind: 'created' }],
    ...overrides,
  }
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function handleReports(server: FakeServer, method: string, parts: string[], body: Raw): Response {
  const [, id, action] = parts
  if (id === undefined) {
    if (method === 'GET') {
      return json(200, { reports: server.reports })
    }
    const report = adminReport({
      id: `new${String(server.reports.length + 1)}`,
      title: body.title,
      stage: body.stage,
      endpoints: body.endpoints ?? [],
      updates: [{ seq: 1, at: clock, actor: 'alice', stage: body.stage, message: body.message }],
      created_at: clock,
      updated_at: clock,
    })
    server.reports.unshift(report)
    return json(201, report)
  }
  const report = server.reports.find((candidate) => candidate.id === id)
  if (report === undefined) {
    return refuse(404, 'not_found')
  }
  if (method === 'PATCH') {
    Object.assign(report, body, { updated_at: clock })
  } else if (action === 'updates') {
    const updates = list<Raw>(report.updates)
    updates.push({ seq: updates.length + 1, at: clock, actor: 'alice', ...body })
    Object.assign(report, { stage: body.stage, updates, updated_at: clock })
  } else if (action === 'publication') {
    report.published_at = body.published === true ? clock : undefined
  }
  return json(method === 'POST' ? 201 : 200, report)
}

function handleIncidents(server: FakeServer, method: string, parts: string[], body: Raw): Response {
  const [, id, action] = parts
  if (id === undefined) {
    if (method === 'GET') {
      return json(200, { incidents: server.incidents })
    }
    const incident = adminIncident({ id: 'new-incident', ...body, created_at: clock })
    server.incidents.unshift(incident)
    return json(201, incident)
  }
  const incident = server.incidents.find((candidate) => candidate.id === id)
  if (incident === undefined) {
    return refuse(404, 'not_found')
  }
  const state = String(incident.state)
  if (method !== 'GET' && state === 'closed') {
    return refuse(409, 'frozen')
  }
  const timeline = list<Raw>(incident.timeline)
  const entry = (fields: Raw) => {
    timeline.push({ seq: timeline.length + 1, at: clock, actor: 'alice', ...fields })
  }
  if (action === 'state') {
    const to = String(body.state)
    if (!(moves.get(state) ?? []).includes(to)) {
      return refuse(409, 'invalid_transition')
    }
    entry({ kind: 'state', from: state, to })
    incident.state = to
  } else if (action === 'notes') {
    entry({ kind: 'note', note: body.note })
  } else if (method === 'PATCH') {
    Object.assign(incident, body)
  }
  incident.timeline = timeline
  return json(action === 'notes' ? 201 : 200, incident)
}

function handlePublic(path: string, options: FakeOptions): Response {
  if (path.startsWith('/api/v1/endpoints/statuses')) {
    return json(200, options.statuses ?? [])
  }
  if (/^\/api\/v1\/endpoints\/[^/]+\/statuses/.test(path)) {
    return json(200, { key: 'x', results: [], events: [] })
  }
  if (path.includes('/response-times/')) {
    return json(200, { timestamps: [], values: [] })
  }
  if (path.startsWith('/api/v1/reports')) {
    return json(200, { reports: options.publicReports ?? [], page: 1, more: false })
  }
  if (path.startsWith('/api/v1/maintenance')) {
    return json(200, { windows: [] })
  }
  return json(200, { oidc: false, authenticated: false, announcements: [] })
}

/** Stubs fetch with a fresh fake server. */
export function fakeServer(options: FakeOptions = {}): FakeServer {
  let next: { status: number | 'network'; body: unknown } | null = null
  const server: FakeServer = {
    calls: [],
    reports: options.reports ?? [adminReport()],
    incidents: options.incidents ?? [adminIncident()],
    failNext: (status, body) => {
      next = { status, body }
    },
    adminCalls: () => server.calls.filter((call) => call.path.startsWith('/api/v1/admin')),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost')
      const method = init.method ?? 'GET'
      const headers = new Headers(init.headers)
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      const path = `${url.pathname}${url.search}`
      server.calls.push({ method, path, body, authorization: headers.get('Authorization') })
      if (!url.pathname.startsWith('/api/v1/admin/')) {
        return Promise.resolve(handlePublic(path, options))
      }
      if (next !== null) {
        const answer = next
        next = null
        return answer.status === 'network'
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(json(answer.status, answer.body ?? {}))
      }
      if (headers.get('Authorization') !== `Bearer ${goodToken}`) {
        return Promise.resolve(refuse(401, 'unauthorized'))
      }
      const parts = url.pathname.slice('/api/v1/admin/'.length).split('/')
      const fields = (body ?? {}) as Raw
      return Promise.resolve(
        parts[0] === 'reports'
          ? handleReports(server, method, parts, fields)
          : handleIncidents(server, method, parts, fields),
      )
    }),
  )
  return server
}
