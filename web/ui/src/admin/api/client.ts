// The one way the admin talks to the server: JSON to /api/v1/admin, with the
// token only in the Authorization header, a 10-second deadline, and every
// failure turned into one of the messages of design spec section 8.

import { isRecord } from '../../api/plugins/read'

export const adminBase = '/api/v1/admin'
const deadlineMs = 10_000

export type FailureKind =
  | 'unauthorized'
  | 'rate-limited'
  | 'unavailable'
  | 'not-running'
  | 'not-found'
  | 'unreachable'
  | 'refused'
  | 'unchanged'

/** The words each failure shows; "refused" uses the server's reason instead. */
export const failureMessages = {
  unauthorized: 'That token was not accepted.',
  rateLimited: 'Too many failed attempts from this address. Wait a minute and try again.',
  unavailable: 'Storage is unavailable. Try again shortly.',
  notRunning: 'The incidents plugin is not running on this server.',
  notFound: 'That record does not exist.',
  unreachable: 'The server could not be reached.',
  unchanged: 'Nothing changed.',
} as const

const messageOf = new Map<Exclude<FailureKind, 'refused'>, string>([
  ['unauthorized', failureMessages.unauthorized],
  ['rate-limited', failureMessages.rateLimited],
  ['unavailable', failureMessages.unavailable],
  ['not-running', failureMessages.notRunning],
  ['not-found', failureMessages.notFound],
  ['unreachable', failureMessages.unreachable],
  ['unchanged', failureMessages.unchanged],
])

/** A request that did not do what was asked. `message` is ready to show. */
export class AdminError extends Error {
  override readonly name = 'AdminError'

  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly status = 0,
  ) {
    super(message)
  }
}

export function failure(kind: Exclude<FailureKind, 'refused'>, status = 0): AdminError {
  return new AdminError(kind, messageOf.get(kind) ?? failureMessages.unreachable, status)
}

// The server's error codes for refusals, in words. "invalid" keeps the
// server's own reason, which names the field.
const refusals = new Map([
  ['invalid_transition', 'That move is not allowed from the incident’s current state.'],
  ['frozen', 'This incident is closed and can no longer change.'],
  ['unknown_endpoint', 'A service named here is not monitored by this server.'],
  ['too_large', 'That is too long to save.'],
])

function refusal(status: number, body: unknown): AdminError {
  const code = isRecord(body) && typeof body.error === 'string' ? body.error : ''
  const reason = isRecord(body) && typeof body.message === 'string' ? body.message : ''
  const known = refusals.get(code)
  if (known !== undefined) {
    return new AdminError('refused', known, status)
  }
  const text = reason === '' ? `The server refused this (error ${String(status)}).` : reason
  return new AdminError('refused', `The server refused this: ${text}`, status)
}

/** Maps a status other than 2xx to an error. A 404 without the API's JSON means no plugin. */
export function errorFor(status: number, body: unknown): AdminError {
  switch (status) {
    case 401:
      return failure('unauthorized', status)
    case 429:
      return failure('rate-limited', status)
    case 503:
      return failure('unavailable', status)
    case 404:
      return isRecord(body) && body.error === 'not_found'
        ? failure('not-found', status)
        : failure('not-running', status)
    default:
      return refusal(status, body)
  }
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT'

/** Sends one request and returns its checked JSON body. */
export type Send = (method: Method, path: string, body?: unknown) => Promise<unknown>

export interface SendOptions {
  token: string
  /** Called on any 401, before the error is thrown, so the page can sign out. */
  onUnauthorized?: () => void
}

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('Content-Type') ?? ''
  if (!type.startsWith('application/json')) {
    return null
  }
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

export function makeSend({ token, onUnauthorized }: SendOptions): Send {
  return async (method, path, body) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }
    const init: RequestInit = {
      method,
      headers,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(deadlineMs),
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await fetch(`${adminBase}${path}`, init)
    } catch {
      // A network failure or the deadline: the request never got an answer.
      throw failure('unreachable')
    }
    const data = await readBody(response)
    if (!response.ok) {
      if (response.status === 401) {
        onUnauthorized?.()
      }
      throw errorFor(response.status, data)
    }
    return data
  }
}
