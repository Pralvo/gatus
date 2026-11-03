// "Why" a check failed, in plain words, from its errors and failing conditions
// (spec section 7). What cannot be put in words is kept as written, marked as
// code, so the page shows it in code style. Server text is only ever returned
// as text.

import type { Result } from '../../api/types'
import { dayMs, durationText, hourMs, nanosToMs } from '../time/format'

import { goDurationMs, parseCondition, wholeNumber, type Condition, type Operator } from './parse'

export interface Reason {
  text: string
  /** True when the text is the server's own words, to be shown in code style. */
  code: boolean
}

const timeoutPattern = /timeout|timed out|deadline exceeded/i

function words(text: string): Reason {
  return { text, code: false }
}

function asWritten(text: string): Reason {
  return { text, code: true }
}

function codeNeed(operator: Operator, expected: number): string {
  const value = String(expected)
  switch (operator) {
    case '==':
      return value
    case '!=':
      return `any code but ${value}`
    case '<':
      return `a code below ${value}`
    case '<=':
      return `a code of ${value} or below`
    case '>':
      return `a code above ${value}`
    case '>=':
      return `a code of ${value} or above`
    default:
      return value
  }
}

function statusWords(condition: Condition): Reason | null {
  const seen = wholeNumber(condition.seen)
  const expected = wholeNumber(condition.expected)
  if (seen === null || expected === null) {
    return null
  }
  let answered = `answered with ${String(seen)}`
  if (seen === 0) {
    answered = 'gave no answer'
  } else if (seen >= 400) {
    answered = `answered with error ${String(seen)}`
  }
  return words(`${answered}; it needs ${codeNeed(condition.operator, expected)}`)
}

function responseTimeWords(condition: Condition): Reason | null {
  const seen = wholeNumber(condition.seen)
  const limit = wholeNumber(condition.expected)
  if (seen === null || limit === null || !['<', '<='].includes(condition.operator)) {
    return null
  }
  return words(`took ${durationText(seen)}; the limit is ${durationText(limit)}`)
}

/** "5 days", "1 day", "36 hours": whole days when the time is a whole number of days. */
function daysOrHours(ms: number): string {
  if (ms % dayMs === 0) {
    const days = ms / dayMs
    return `${String(days)} ${days === 1 ? 'day' : 'days'}`
  }
  const hours = Math.round(ms / hourMs)
  return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`
}

function expiresIn(ms: number): string {
  if (ms <= 0) {
    return 'has expired'
  }
  if (ms < hourMs) {
    return 'expires in under an hour'
  }
  if (ms < dayMs) {
    return `expires in ${daysOrHours(Math.floor(ms / hourMs) * hourMs)}`
  }
  return `expires in ${daysOrHours(Math.floor(ms / dayMs) * dayMs)}`
}

function expiryWords(condition: Condition, what: string): Reason | null {
  const seen = goDurationMs(condition.seen)
  const needed = goDurationMs(condition.expected)
  if (seen === null || needed === null || !['>', '>='].includes(condition.operator)) {
    return null
  }
  // "it needs more than 7" in the spec: whole days drop the unit, which the
  // sentence has just given.
  const neededText =
    needed % dayMs === 0 && seen >= dayMs ? String(needed / dayMs) : daysOrHours(needed)
  const comparison = condition.operator === '>' ? 'more than' : 'at least'
  return words(`${what} ${expiresIn(seen)}; it needs ${comparison} ${neededText}`)
}

function conditionWords(condition: Condition): Reason | null {
  switch (condition.placeholder) {
    case 'STATUS':
      return statusWords(condition)
    case 'RESPONSE_TIME':
      return responseTimeWords(condition)
    case 'CERTIFICATE_EXPIRATION':
      return expiryWords(condition, 'its security certificate')
    case 'DOMAIN_EXPIRATION':
      return expiryWords(condition, 'its domain registration')
    case 'CONNECTED':
      return condition.seen === 'false' ? words('it could not connect') : null
    default:
      return null
  }
}

/** Words for one failing condition string; the string itself, as code, when unreadable. */
export function conditionReason(raw: string): Reason {
  const parsed = parseCondition(raw)
  return (parsed === null ? null : conditionWords(parsed)) ?? asWritten(raw)
}

function errorReason(error: string, durationMs: number): Reason {
  if (!timeoutPattern.test(error)) {
    return asWritten(error)
  }
  const seconds = Math.round(durationMs / 1000)
  return words(
    seconds >= 1
      ? `no answer within ${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}`
      : 'no answer in time',
  )
}

/**
 * Why a result failed. Errors explain a failure on their own, since every
 * condition fails after one, so they come first and alone. A passing result,
 * or a failing one with no error and no failing condition, gives an empty list.
 */
export function whyFailed(result: Result | undefined): Reason[] {
  if (result === undefined || result.success) {
    return []
  }
  const errors = (result.errors ?? []).filter((error) => error.trim() !== '')
  const reasons =
    errors.length > 0
      ? errors.map((error) => errorReason(error, nanosToMs(result.duration)))
      : (result.conditionResults ?? [])
          .filter((condition) => !condition.success)
          .map((condition) => conditionReason(condition.condition))
  const seen = new Set<string>()
  return reasons.filter((reason) => {
    const fresh = !seen.has(reason.text)
    seen.add(reason.text)
    return fresh
  })
}

/** The reasons as one plain clause: "answered with error 503; it needs a code below 500". */
export function whyText(reasons: Reason[]): string {
  return reasons.length === 0
    ? 'the check gave no reason'
    : reasons.map((reason) => reason.text).join(', and ')
}
