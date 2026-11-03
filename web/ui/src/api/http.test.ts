import { afterEach, describe, expect, it, vi } from 'vitest'

import { getJSON, getNumber, HttpError, ResponseFormatError } from './http'

function answer(body: string, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(body, { status }))),
  )
}

function rejectOnAbort(init: RequestInit, reject: (reason: Error) => void): void {
  init.signal?.addEventListener('abort', () => {
    const reason: unknown = init.signal?.reason
    reject(reason instanceof Error ? reason : new Error('aborted'))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getJSON', () => {
  it('returns the parsed body and sends same-origin credentials only', async () => {
    answer('{"ok":true}')
    await expect(getJSON<{ ok: boolean }>('/api/v1/config')).resolves.toEqual({ ok: true })
    const init = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(init?.credentials).toBe('same-origin')
    expect(init?.headers).toMatchObject({ Accept: 'application/json' })
  })

  it('names the address and status when the server refuses', async () => {
    answer('nope', 503)
    const failure = getJSON('/api/v1/config')
    await expect(failure).rejects.toBeInstanceOf(HttpError)
    await expect(failure).rejects.toMatchObject({ status: 503, url: '/api/v1/config' })
  })

  it('says so when the body is not JSON', async () => {
    answer('<html>')
    await expect(getJSON('/api/v1/config')).rejects.toBeInstanceOf(ResponseFormatError)
  })

  it('gives up after its deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            rejectOnAbort(init, reject)
          }),
      ),
    )
    await expect(getJSON('/slow', { timeoutMs: 10 })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('stops when the caller cancels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            rejectOnAbort(init, reject)
          }),
      ),
    )
    const controller = new AbortController()
    const request = getJSON('/slow', { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('getNumber', () => {
  it('reads a plain-text number', async () => {
    answer('0.998611\n')
    await expect(getNumber('/uptime')).resolves.toBeCloseTo(0.998611)
  })

  it.each(['', 'NaN', 'abc'])('refuses %j', async (body) => {
    answer(body)
    await expect(getNumber('/uptime')).rejects.toBeInstanceOf(ResponseFormatError)
  })
})
