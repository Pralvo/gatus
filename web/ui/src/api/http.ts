// Small fetch helpers: a deadline on every request, and errors that say what failed.

const defaultTimeoutMs = 10_000

/** A request that reached the server and got a status other than 2xx. */
export class HttpError extends Error {
  override readonly name = 'HttpError'

  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} answered ${String(status)}`)
  }
}

/** A response that arrived but could not be read as the expected type. */
export class ResponseFormatError extends Error {
  override readonly name = 'ResponseFormatError'

  constructor(
    readonly url: string,
    detail: string,
  ) {
    super(`${url} sent an unexpected response: ${detail}`)
  }
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  headers?: Record<string, string>
}

async function send(
  url: string,
  options: RequestOptions,
  init: RequestInit = {},
): Promise<Response> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? defaultTimeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  const response = await fetch(url, {
    ...init,
    signal,
    credentials: 'same-origin',
    headers: { ...options.headers, ...(init.headers as Record<string, string> | undefined) },
  })
  if (!response.ok) {
    throw new HttpError(url, response.status)
  }
  return response
}

export async function getJSON<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(url, options, { headers: { Accept: 'application/json' } })
  try {
    return (await response.json()) as T
  } catch {
    throw new ResponseFormatError(url, 'not JSON')
  }
}

export async function getNumber(url: string, options: RequestOptions = {}): Promise<number> {
  const response = await send(url, options)
  const text = (await response.text()).trim()
  const value = Number(text)
  if (text === '' || !Number.isFinite(value)) {
    throw new ResponseFormatError(url, 'not a number')
  }
  return value
}
