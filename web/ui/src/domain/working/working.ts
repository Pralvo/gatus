// "What working means" for a service, built from its check's conditions and
// nothing else (spec sections 0 and 7). It describes what the check tests,
// never how the service is built, and it is the same code for every service.

import { goDurationMs, parseCondition, wholeNumber, type Condition } from '../conditions/parse'
import { dayMs, hourMs, secondMs } from '../time/format'

export interface WorkingMeaning {
  /** "It answers with success (200) within 5 seconds, and ..."; null when no condition is readable. */
  sentence: string | null
  /** Conditions this cannot put in words, as written, for the page to show in code style. */
  unrecognised: string[]
}

function equalStatus(code: number): string {
  if (code === 200) {
    return 'answers with success (200)'
  }
  if (code === 204) {
    return 'answers with 204 (success, no content)'
  }
  if (code >= 200 && code < 300) {
    return `answers with ${String(code)} (success)`
  }
  return `answers with ${String(code)}`
}

function belowStatus(code: number): string {
  if (code === 500) {
    return 'answers without a server error (any code below 500)'
  }
  if (code === 400) {
    return 'answers without an error (any code below 400)'
  }
  return `answers with a code below ${String(code)}`
}

function statusPhrase(condition: Condition): string | null {
  const code = wholeNumber(condition.expected)
  if (code === null) {
    return null
  }
  const value = String(code)
  switch (condition.operator) {
    case '==':
      return equalStatus(code)
    case '<':
      return belowStatus(code)
    case '<=':
      return `answers with a code of ${value} or below`
    case '>':
      return `answers with a code above ${value}`
    case '>=':
      return `answers with a code of ${value} or above`
    case '!=':
      return `answers with any code but ${value}`
    default:
      return null
  }
}

function amount(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`
}

function timePhrase(condition: Condition): string | null {
  const limit = wholeNumber(condition.expected)
  if (limit === null || limit <= 0 || !['<', '<='].includes(condition.operator)) {
    return null
  }
  if (limit < secondMs) {
    return `within ${amount(limit, 'millisecond')}`
  }
  const seconds = Number((limit / secondMs).toFixed(1))
  return `within ${amount(seconds, 'second')}`
}

function validityPhrase(condition: Condition, what: string): string | null {
  const needed = goDurationMs(condition.expected)
  if (needed === null || needed <= 0 || !['>', '>='].includes(condition.operator)) {
    return null
  }
  const comparison = condition.operator === '>' ? 'more than' : 'at least'
  const span =
    needed % dayMs === 0
      ? amount(needed / dayMs, 'day')
      : amount(Math.round(needed / hourMs), 'hour')
  return `${what} is valid for ${comparison} ${span}`
}

type PartKind = 'answer' | 'within' | 'connected' | 'extra'

interface Part {
  kind: PartKind
  text: string
}

function partOf(condition: Condition | null): Part | null {
  const make = (kind: PartKind, text: string | null): Part | null =>
    text === null ? null : { kind, text }
  switch (condition?.placeholder) {
    case 'STATUS':
      return make('answer', statusPhrase(condition))
    case 'RESPONSE_TIME':
      return make('within', timePhrase(condition))
    case 'CERTIFICATE_EXPIRATION':
      return make('extra', validityPhrase(condition, 'its security certificate'))
    case 'DOMAIN_EXPIRATION':
      return make('extra', validityPhrase(condition, 'its domain registration'))
    case 'CONNECTED':
      return make('connected', condition.expected === 'true' ? 'can be reached' : null)
    default:
      return null
  }
}

interface Phrases {
  answer: string | null
  within: string | null
  connected: boolean
  extras: string[]
  unrecognised: string[]
}

/** Sorts conditions into phrases. A second answer or time limit is kept as written. */
function sort(conditions: string[]): Phrases {
  const phrases: Phrases = {
    answer: null,
    within: null,
    connected: false,
    extras: [],
    unrecognised: [],
  }
  for (const raw of conditions) {
    const part = partOf(parseCondition(raw))
    if (part?.kind === 'answer' && phrases.answer === null) {
      phrases.answer = part.text
    } else if (part?.kind === 'within' && phrases.within === null) {
      phrases.within = part.text
    } else if (part?.kind === 'connected') {
      phrases.connected = true
    } else if (part?.kind === 'extra') {
      phrases.extras.push(part.text)
    } else {
      phrases.unrecognised.push(raw)
    }
  }
  return phrases
}

function mainClause(phrases: Phrases): string | null {
  if (phrases.answer !== null) {
    return [phrases.answer, phrases.within].filter((part) => part !== null).join(' ')
  }
  if (phrases.within !== null) {
    return `answers ${phrases.within}`
  }
  return phrases.connected ? 'can be reached' : null
}

/**
 * Describes what a check tests, from its condition strings, in one sentence:
 * "It answers with success (200) within 5 seconds, and its security
 * certificate is valid for more than 7 days." The subject is "It" because a
 * condition does not say which page it asks for.
 */
export function workingMeaning(conditions: string[]): WorkingMeaning {
  const phrases = sort(conditions)
  const main = mainClause(phrases)
  const clauses = main === null ? phrases.extras : [`it ${main}`, ...phrases.extras]
  if (clauses.length === 0) {
    return { sentence: null, unrecognised: phrases.unrecognised }
  }
  const last = clauses.at(-1) ?? ''
  const joined = clauses.length === 1 ? last : `${clauses.slice(0, -1).join(', ')}, and ${last}`
  return {
    sentence: `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`,
    unrecognised: phrases.unrecognised,
  }
}
