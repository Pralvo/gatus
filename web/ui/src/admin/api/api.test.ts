import { afterEach, describe, expect, it, vi } from 'vitest'

import { adminIncident, adminReport } from '../test/server'

import { AdminError, errorFor, makeSend } from './client'
import { incidentCalls, readAdminIncident } from './incidents'
import { readAdminReport, reportCalls } from './reports'

afterEach(() => {
  vi.unstubAllGlobals()
})

function answer(status: number, body: unknown, type = 'application/json') {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': type },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function failureOf(promise: Promise<unknown>): Promise<AdminError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AdminError) {
      return error
    }
  }
  throw new Error('expected an AdminError')
}

describe('requests', () => {
  it('sends the token only as a bearer header, with JSON and no cookies', async () => {
    const fetchMock = answer(201, adminReport())
    const calls = reportCalls(makeSend({ token: 'secret' }))
    await calls.addReportUpdate('a1b2', 'identified', 'Found it.')
    const [url, init = {}] = fetchMock.mock.calls[0] ?? ['']
    expect(url).toBe('/api/v1/admin/reports/a1b2/updates')
    expect(url).not.toContain('secret')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret')
    expect(JSON.parse(String(init.body))).toEqual({ stage: 'identified', message: 'Found it.' })
  })

  it('escapes ids in paths', async () => {
    const fetchMock = answer(200, adminIncident())
    await incidentCalls(makeSend({ token: 't' })).getIncident('../config')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/incidents/..%2Fconfig')
  })

  it('calls back on a 401 so the page can sign out', async () => {
    answer(401, { error: 'unauthorized' })
    const onUnauthorized = vi.fn()
    const failed = await failureOf(
      reportCalls(makeSend({ token: 't', onUnauthorized })).listReports(),
    )
    expect(failed.message).toBe('That token was not accepted.')
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('says the server could not be reached on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const failed = await failureOf(reportCalls(makeSend({ token: 't' })).listReports())
    expect(failed.kind).toBe('unreachable')
    expect(failed.message).toBe('The server could not be reached.')
  })
})

describe('error messages', () => {
  it.each([
    [
      429,
      { error: 'rate_limited' },
      'Too many failed attempts from this address. Wait a minute and try again.',
    ],
    [503, { error: 'unavailable' }, 'Storage is unavailable. Try again shortly.'],
    [404, { error: 'not_found' }, 'That record does not exist.'],
    [404, null, 'The incidents plugin is not running on this server.'],
    [
      409,
      { error: 'invalid_transition' },
      'That move is not allowed from the incident’s current state.',
    ],
    [409, { error: 'frozen' }, 'This incident is closed and can no longer change.'],
    [
      400,
      { error: 'invalid', message: 'title is required' },
      'The server refused this: title is required',
    ],
  ])('maps %i %j to its words', (status, body, words) => {
    expect(errorFor(status, body).message).toBe(words)
  })

  it('treats a 404 page that is not the API’s JSON as a missing plugin', async () => {
    answer(404, '404 page not found', 'text/plain')
    const failed = await failureOf(reportCalls(makeSend({ token: 't' })).getReport('x'))
    expect(failed.kind).toBe('not-running')
  })
})

describe('reading records', () => {
  it('reads a report and puts its updates in order', () => {
    const report = readAdminReport(
      adminReport({
        published_at: '2026-11-02T13:50:00Z',
        endpoints: [
          { key: 'media', impact: 'partial' },
          { key: 'blog', impact: 'unknown' },
        ],
        updates: [
          { seq: 2, at: '2026-11-02T13:55:00Z', actor: 'bob', stage: 'identified', message: 'b' },
          {
            seq: 1,
            at: '2026-11-02T13:44:00Z',
            actor: 'alice',
            stage: 'investigating',
            message: 'a',
          },
        ],
      }),
    )
    expect(report?.publishedAt).toBe(Date.UTC(2026, 10, 2, 13, 50))
    expect(report?.endpoints).toEqual([{ key: 'media', impact: 'partial' }])
    expect(report?.updates.map((update) => update.message)).toEqual(['a', 'b'])
  })

  it('drops records missing what identifies them', () => {
    expect(readAdminReport(adminReport({ id: '' }))).toBeUndefined()
    expect(readAdminIncident(adminIncident({ state: 'paused' }))).toBeUndefined()
    expect(readAdminIncident(adminIncident())?.commander).toBe('')
  })
})
