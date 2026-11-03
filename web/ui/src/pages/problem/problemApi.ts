// Calls to the problem-reports plugin. The settings say whether the form is on
// and what the notice links to; a server without the plugin answers 404, and
// the page then shows no link and no form.

import { useQuery } from '@tanstack/react-query'

import { getJSON } from '../../api/http'
import { isRecord, readName } from '../../api/plugins/read'

const base = '/api/v1/problem-reports'
const deadlineMs = 10_000

export interface ProblemSettings {
  privacyUrl: string
  contact: string
  retentionDays: number
}

/** An https address, or a path on this site; anything else is not a link. */
export function safeLink(value: string): string | undefined {
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value
  }
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/** A mailto: link for an email address, or the https address itself. */
export function contactLink(contact: string): string | undefined {
  if (/^[^\s@<>"]+@[^\s@<>"]+$/.test(contact)) {
    return `mailto:${contact}`
  }
  return contact.startsWith('https://') ? safeLink(contact) : undefined
}

export function readSettings(body: unknown): ProblemSettings | null {
  if (!isRecord(body) || body.enabled !== true) {
    return null
  }
  const privacyUrl = readName(body.privacyUrl)
  const contact = readName(body.contact)
  const days = body.retentionDays
  if (privacyUrl === undefined || safeLink(privacyUrl) === undefined || contact === undefined) {
    return null
  }
  if (contactLink(contact) === undefined || typeof days !== 'number' || !(days > 0)) {
    return null
  }
  return { privacyUrl, contact, retentionDays: Math.floor(days) }
}

/** The settings, or null when the form is off or the server cannot say. */
export async function getProblemSettings(): Promise<ProblemSettings | null> {
  try {
    return readSettings(await getJSON<unknown>(`${base}/settings`))
  } catch {
    return null
  }
}

export function useProblemSettings() {
  return useQuery({
    queryKey: ['problem-reports', 'settings'],
    queryFn: getProblemSettings,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export interface ProblemDraft {
  description: string
  details: string
  service: string
  page: string
  /** The hidden field people never see. */
  website: string
}

export type SendOutcome =
  | { kind: 'sent'; reference: string }
  | { kind: 'refused'; message: string }
  | { kind: 'rate-limited' }
  | { kind: 'failed' }

/** Sends one report. Only the draft's fields leave the page. */
export async function sendProblemReport(draft: ProblemDraft): Promise<SendOutcome> {
  let response: Response
  try {
    response = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(draft),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(deadlineMs),
    })
  } catch {
    return { kind: 'failed' }
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // An answer without JSON is handled by its status below.
  }
  if (response.status === 201 && isRecord(body) && typeof body.reference === 'string') {
    return { kind: 'sent', reference: body.reference }
  }
  if (response.status === 429) {
    return { kind: 'rate-limited' }
  }
  if (response.status === 400 && isRecord(body) && typeof body.message === 'string') {
    return { kind: 'refused', message: body.message }
  }
  return { kind: 'failed' }
}
