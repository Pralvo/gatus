// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { bustedUrl, probe } from './probe'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('probe', () => {
  it('fetches opaquely, uncached, without cookies or referrer, and times the answer', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const times = [100, 282]
    const outcome = await probe('https://pralvo.com/blog/', {
      clock: () => times.shift() ?? 0,
      nonce: () => 'abc',
    })
    expect(outcome).toEqual({ reached: true, ms: 182 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pralvo.com/blog/?check=abc',
      expect.objectContaining({
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }),
    )
  })

  it('counts a network error as not reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    expect(await probe('https://pralvo.com/')).toEqual({ reached: false, timedOut: false })
  })

  it('gives up after the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('timed out', 'TimeoutError'))
            })
          }),
      ),
    )
    expect(await probe('https://pralvo.com/', { timeoutMs: 20 })).toEqual({
      reached: false,
      timedOut: true,
    })
  })
})

describe('bustedUrl', () => {
  it('adds the random value and keeps the rest of the address', () => {
    expect(bustedUrl('https://media.pralvo.com/a?b=1', 'n')).toBe(
      'https://media.pralvo.com/a?b=1&check=n',
    )
  })
})
