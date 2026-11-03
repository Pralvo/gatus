// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { minuteOptions, useMinuteCycle, useNow } from './cycle'
import { counted, failuresInRow } from './streak'

interface Answer {
  status: number
  body: unknown
}
let answers: Map<string, Answer>

function route(url: string): Answer {
  const path = url.split('?')[0] ?? url
  return answers.get(path) ?? { status: 200, body: {} }
}

function answer(path: string, body: unknown, status = 200): void {
  answers.set(path, { status, body })
}

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  answers = new Map()
  answer('/api/v1/endpoints/statuses', [{ key: 'media', name: 'Media', results: [] }])
  answer('/api/v1/reports', { reports: [], page: 1, more: false })
  answer('/api/v1/maintenance', { windows: [] })
  answer('/api/v1/config', { oidc: false, authenticated: false, announcements: [] })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const { status, body } = route(url)
      return Promise.resolve(new Response(JSON.stringify(body), { status }))
    }),
  )
})

afterEach(() => {
  client.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useMinuteCycle', () => {
  it('loads the four queries and records the time of success', async () => {
    const { result } = renderHook(() => useMinuteCycle(), { wrapper })
    await waitFor(() => {
      expect(result.current.config.isSuccess).toBe(true)
    })
    expect(result.current.statuses.data?.[0]?.key).toBe('media')
    expect(result.current.refresh).toMatchObject({ failuresInRow: 0 })
    expect(result.current.refresh.lastSuccessAt).not.toBeNull()
    expect(result.current.noticesFailed).toBe(false)
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toContain(
      '/api/v1/endpoints/statuses?page=1&pageSize=100',
    )
  })

  it('keeps the last good data when a refresh fails, and counts failures in a row', async () => {
    const { result } = renderHook(() => useMinuteCycle(), { wrapper })
    await waitFor(() => {
      expect(result.current.statuses.isSuccess).toBe(true)
    })
    const firstSuccess = result.current.refresh.lastSuccessAt
    answer('/api/v1/endpoints/statuses', 'down', 502)
    await act(() => result.current.refreshNow())
    await act(() => result.current.refreshNow())
    await waitFor(() => {
      expect(result.current.refresh.failuresInRow).toBe(2)
    })
    expect(result.current.statuses.isError).toBe(true)
    expect(result.current.statuses.data?.[0]?.key).toBe('media')
    expect(result.current.refresh).toEqual({ lastSuccessAt: firstSuccess, failuresInRow: 2 })
    answer('/api/v1/endpoints/statuses', [])
    await act(() => result.current.refreshNow())
    // React Query tells React about the new state on the next tick.
    await waitFor(() => {
      expect(result.current.refresh.failuresInRow).toBe(0)
    })
    expect(result.current.statuses.data).toEqual([])
  })

  it('warns when reports fail while checks load', async () => {
    answer('/api/v1/reports', { error: 'reports are unavailable' }, 503)
    const { result } = renderHook(() => useMinuteCycle(), { wrapper })
    await waitFor(() => {
      expect(result.current.reports.isError).toBe(true)
    })
    expect(result.current.noticesFailed).toBe(true)
  })

  it('treats a plugin that is not enabled as having nothing to show', async () => {
    answer('/api/v1/maintenance', { error: 'not found' }, 404)
    answer('/api/v1/reports', { error: 'not found' }, 404)
    const { result } = renderHook(() => useMinuteCycle(), { wrapper })
    await waitFor(() => {
      expect(result.current.maintenance.isSuccess).toBe(true)
    })
    expect(result.current.maintenance.data).toEqual([])
    expect(result.current.reports.data?.reports).toEqual([])
    expect(result.current.noticesFailed).toBe(false)
  })

  it('reports nothing loaded when the statuses fail first time', async () => {
    answer('/api/v1/endpoints/statuses', 'down', 500)
    const { result } = renderHook(() => useMinuteCycle(), { wrapper })
    await waitFor(() => {
      expect(result.current.statuses.isError).toBe(true)
    })
    expect(result.current.statuses.data).toBeUndefined()
    expect(result.current.refresh.lastSuccessAt).toBeNull()
  })
})

describe('refresh schedule', () => {
  it('refreshes every minute, then every 5 minutes after 3 failures in a row', async () => {
    const key = ['test']
    const options = minuteOptions(client, key, () => Promise.reject(new Error('x')), { live: true })
    const interval = options.refetchInterval
    if (typeof interval !== 'function') {
      throw new Error('expected a schedule')
    }
    expect(interval()).toBe(60_000)
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(options.queryFn()).rejects.toThrow('x')
    }
    expect(failuresInRow(client, key)).toBe(3)
    expect(interval()).toBe(300_000)
    expect(options).toMatchObject({ retry: false, refetchIntervalInBackground: false })
  })

  it('never refreshes in time travel', () => {
    const options = minuteOptions(client, ['t'], () => Promise.resolve(1), { live: false })
    expect(options).toMatchObject({ refetchInterval: false, refetchOnWindowFocus: false })
  })

  it('resets the count on success', async () => {
    let fail = true
    const run = counted(client, ['c'], () =>
      fail ? Promise.reject(new Error('no')) : Promise.resolve(1),
    )
    await expect(run()).rejects.toThrow('no')
    expect(failuresInRow(client, ['c'])).toBe(1)
    fail = false
    await expect(run()).resolves.toBe(1)
    expect(failuresInRow(client, ['c'])).toBe(0)
  })
})

describe('useNow', () => {
  it('ticks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 3, 14, 0)))
    const { result } = renderHook(() => useNow(1000))
    expect(result.current).toBe(Date.UTC(2026, 10, 3, 14, 0))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(Date.UTC(2026, 10, 3, 14, 0, 1))
  })
})
