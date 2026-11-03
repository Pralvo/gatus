// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { report } from '../test/fixtures'

import {
  isNotFound,
  useFullReports,
  useReport,
  useServiceEvents,
  useUptime,
  useUsualSpeeds,
} from './service'

let answers: Map<string, { status: number; body: string }>
let client: QueryClient

function answer(url: string, body: unknown, status = 200): void {
  answers.set(url, { status, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function calls(): string[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => url as string)
}

const wireReport = {
  id: 'r1',
  title: 'Full',
  stage: 'identified',
  endpoints: [],
  updates: [
    { stage: 'identified', at: '2026-11-02T13:51:00Z', message: 'b' },
    { stage: 'investigating', at: '2026-11-02T13:44:00Z', message: 'a' },
  ],
  publishedAt: '2026-11-02T13:44:00Z',
  updatedAt: '2026-11-02T13:51:00Z',
}

beforeEach(() => {
  client = new QueryClient()
  answers = new Map()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const found = answers.get(url) ?? { status: 404, body: '{}' }
      return Promise.resolve(new Response(found.body, { status: found.status }))
    }),
  )
})

afterEach(() => {
  client.clear()
  vi.unstubAllGlobals()
})

describe('per-service hooks', () => {
  it('collects events by key and says when one request failed', async () => {
    answer('/api/v1/endpoints/media/statuses?page=1&pageSize=1', {
      key: 'media',
      results: [],
      events: [{ type: 'START', timestamp: '2026-10-12T09:00:00Z' }],
    })
    answer('/api/v1/endpoints/blog/statuses?page=1&pageSize=1', 'down', 500)
    const { result } = renderHook(() => useServiceEvents(['media', 'blog']), { wrapper })
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.byKey.get('media')).toHaveLength(1)
    expect(result.current.byKey.has('blog')).toBe(false)
    expect(result.current.failed).toBe(true)
  })

  it('takes the usual speed from the 7-day history', async () => {
    answer('/api/v1/endpoints/media/response-times/7d/history', {
      timestamps: [1, 2, 3],
      values: [60, 70, 90],
    })
    answer('/api/v1/endpoints/blog/response-times/7d/history', { timestamps: [], values: [] })
    const { result } = renderHook(() => useUsualSpeeds(['media', 'blog']), { wrapper })
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.byKey.get('media')).toBe(70)
    expect(result.current.byKey.get('blog')).toBeNull()
    expect(result.current.failed).toBe(false)
  })

  it('loads uptime only once enabled', async () => {
    answer('/api/v1/endpoints/media/uptimes/30d', '0.998')
    const { result, rerender } = renderHook(({ on }) => useUptime('media', on), {
      wrapper,
      initialProps: { on: false },
    })
    expect(calls()).toEqual([])
    rerender({ on: true })
    await waitFor(() => {
      expect(result.current.data).toBe(0.998)
    })
  })
})

describe('report hooks', () => {
  it('loads a report', async () => {
    answer('/api/v1/reports/r1', wireReport)
    const { result } = renderHook(() => useReport('r1'), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.updates).toHaveLength(2)
  })

  it('does not retry a report that does not exist', async () => {
    const { result } = renderHook(() => useReport('draft'), { wrapper })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(isNotFound(result.current.error)).toBe(true)
    expect(calls()).toEqual(['/api/v1/reports/draft'])
  })

  it('falls back to the list item until the full report loads', async () => {
    answer('/api/v1/reports/r1', wireReport)
    const listed = [report({ id: 'r1', title: 'Listed' }), report({ id: 'gone', title: 'Gone' })]
    const { result } = renderHook(() => useFullReports(listed), { wrapper })
    expect(result.current.byKey.get('r1')?.title).toBe('Listed')
    await waitFor(() => {
      expect(result.current.byKey.get('r1')?.title).toBe('Full')
    })
    expect(result.current.byKey.get('gone')?.title).toBe('Gone')
    expect(result.current.failed).toBe(true)
  })
})
