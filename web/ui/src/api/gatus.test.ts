import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getEndpointStatus,
  getEndpointStatuses,
  getResponseTimeHistory,
  getServerConfig,
  getSuiteStatus,
  getUptime,
} from './gatus'

function requestedUrl(): string {
  return vi.mocked(fetch).mock.calls[0]?.[0] as string
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}'))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Gatus API addresses', () => {
  it('asks for the config', async () => {
    await getServerConfig()
    expect(requestedUrl()).toBe('/api/v1/config')
  })

  it('asks for the first page of every endpoint', async () => {
    await getEndpointStatuses(50)
    expect(requestedUrl()).toBe('/api/v1/endpoints/statuses?page=1&pageSize=50')
  })

  it('encodes keys so they cannot change the path', async () => {
    await getEndpointStatus('public site/../admin', 2, 20)
    expect(requestedUrl()).toBe(
      '/api/v1/endpoints/public%20site%2F..%2Fadmin/statuses?page=2&pageSize=20',
    )
    await getSuiteStatus('a?b')
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe('/api/v1/suites/a%3Fb/statuses')
  })

  it('asks for uptime and response-time history by window', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('1.000000'))
    await expect(getUptime('public-site_website', '7d')).resolves.toBe(1)
    expect(requestedUrl()).toBe('/api/v1/endpoints/public-site_website/uptimes/7d')
    await getResponseTimeHistory('public-site_website', '30d')
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      '/api/v1/endpoints/public-site_website/response-times/30d/history',
    )
  })
})

describe('argument checks', () => {
  it.each([0, -1, 1.5])('refuses page %s before sending anything', (pageNumber) => {
    expect(() => getEndpointStatus('k', pageNumber, 20)).toThrow(RangeError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses an empty key', () => {
    expect(() => getUptime('', '24h')).toThrow(RangeError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a page size below 1', () => {
    expect(() => getEndpointStatuses(0)).toThrow(RangeError)
  })
})
