// Reads Gatus condition strings. A passing condition comes back as written,
// "[STATUS] == 200"; a failing one carries the value it saw in brackets,
// "[STATUS] (503) == 200". Anything this cannot read returns null, and callers
// show it as written.

import type { Result } from '../../api/types'

export type Operator = '==' | '!=' | '<' | '<=' | '>' | '>='

export interface Condition {
  /** The whole string as Gatus sent it. */
  raw: string
  /** The placeholder name without brackets: "STATUS", "RESPONSE_TIME". */
  placeholder: string
  /** The value Gatus saw, present only on a failing condition. */
  seen: string | null
  operator: Operator
  expected: string
}

// "[NAME]", an optional "(seen)", an operator and the expected value. The
// placeholder must be the whole left side, so "[BODY].status" is not read.
const withSeen = /^\[([A-Z_]+)\] \(([^()]*)\) (==|!=|<=|>=|<|>) (\S.*)$/
const withoutSeen = /^\[([A-Z_]+)\] (==|!=|<=|>=|<|>) (\S.*)$/

function build(raw: string, parts: (string | undefined)[], seen: string | null): Condition {
  const [placeholder = '', operator = '==', expected = ''] = parts
  return { raw, placeholder, seen, operator: operator as Operator, expected: expected.trim() }
}

export function parseCondition(raw: string): Condition | null {
  const trimmed = raw.trim()
  const seenMatch = withSeen.exec(trimmed)
  if (seenMatch !== null) {
    const [, placeholder, seen = '', operator, expected] = seenMatch
    return build(raw, [placeholder, operator, expected], seen)
  }
  const plainMatch = withoutSeen.exec(trimmed)
  return plainMatch === null ? null : build(raw, plainMatch.slice(1), null)
}

/** A whole number, or null for anything else ("any(200, 201)", "1e3", ""). */
export function wholeNumber(text: string | null): number | null {
  if (text === null || !/^-?\d{1,15}$/.test(text)) {
    return null
  }
  return Number(text)
}

const goUnits = new Map<string, number>([
  ['ns', 1e-6],
  ['us', 1e-3],
  ['µs', 1e-3],
  ['ms', 1],
  ['s', 1000],
  ['m', 60_000],
  ['h', 3_600_000],
])

// One number and unit of a Go duration such as "119h59m30s".
const goPart = /(\d+\.\d+|\d+)(ns|us|µs|ms|s|m|h)/g

/** A Go duration string ("168h", "1h30m", "-5s", "0s") in milliseconds, or null. */
export function goDurationMs(text: string | null): number | null {
  if (text === null || text.length > 64) {
    return null
  }
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  if (body === '0') {
    return 0
  }
  let total = 0
  let consumed = 0
  for (const [part, amount = '', unit = ''] of body.matchAll(goPart)) {
    total += Number(amount) * (goUnits.get(unit) ?? Number.NaN)
    consumed += part.length
  }
  if (body === '' || consumed !== body.length || !Number.isFinite(total)) {
    return null
  }
  return negative ? -total : total
}

/** The condition strings of a result, as written: resolved values removed where readable. */
export function conditionsOf(result: Result | undefined): string[] {
  return (result?.conditionResults ?? []).map(({ condition }) => {
    const parsed = parseCondition(condition)
    return parsed === null
      ? condition
      : `[${parsed.placeholder}] ${parsed.operator} ${parsed.expected}`
  })
}
