// "Is it just me?" probes (spec 9.4): the visitor's own browser asks a public
// page for an answer. The request is opaque (no-cors), uncached, without
// cookies or referrer, and carries a random query value so no cache answers
// for the page. Nothing about the result is sent anywhere.

import type { ProbeOutcome } from '../../domain/justme/verdict'

export const probeTimeoutMs = 10_000

export interface ProbeOptions {
  timeoutMs?: number
  /** Stops the probe early, as when the page goes away. */
  signal?: AbortSignal
  /** A clock in milliseconds; performance.now by default. */
  clock?: () => number
  /** A random value for the cache-busting query; crypto by default. */
  nonce?: () => string
}

function randomNonce(): string {
  const bytes = new Uint32Array(2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (part) => part.toString(36)).join('')
}

/** The page's address with a random `check` query value added. */
export function bustedUrl(url: string, nonce: string): string {
  const address = new URL(url)
  address.searchParams.set('check', nonce)
  return address.toString()
}

/** Fetches one page from the browser. Any answer, opaque or not, counts as reached. */
export async function probe(url: string, options: ProbeOptions = {}): Promise<ProbeOutcome> {
  const clock = options.clock ?? (() => performance.now())
  const timeoutMs = options.timeoutMs ?? probeTimeoutMs
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  const started = clock()
  try {
    await fetch(bustedUrl(url, (options.nonce ?? randomNonce)()), {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    })
    return { reached: true, ms: Math.max(0, Math.round(clock() - started)) }
  } catch {
    return { reached: false, timedOut: deadline.aborted }
  }
}
