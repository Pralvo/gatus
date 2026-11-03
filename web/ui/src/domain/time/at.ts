// The time-travel moment in the address: ?at=<UTC ISO time>, rounded down to
// the minute, and the links that carry it.

import { floorToMinute, utcDate } from './format'

export type AtProblem = 'invalid' | 'future' | 'before-record'

export type AtResult = { ok: true; at: number } | { ok: false; problem: AtProblem; message: string }

export interface AtLimits {
  now: number
  /** When monitoring began; null while unknown, which skips that check. */
  recordStart: number | null
}

// Year, month, day, hour and minute, then optional seconds with an optional
// fraction, then an optional UTC zone. Any other zone is refused: the page
// speaks UTC only.
const isoHead = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
const isoSeconds = /^:(\d{2})$/
const isoSecondsWithFraction = /^:(\d{2})\.\d+$/
const utcZones = ['Z', 'z', '+00:00']

/** The longest value worth parsing; anything longer is refused unread. */
const maxLength = 40

/** Seconds from the part after the minute, or undefined when it is malformed. */
function secondsOf(tail: string): number | undefined {
  const zone = utcZones.find((candidate) => tail.endsWith(candidate)) ?? ''
  const rest = tail.slice(0, tail.length - zone.length)
  if (rest === '') {
    return 0
  }
  const match = isoSeconds.exec(rest) ?? isoSecondsWithFraction.exec(rest)
  return match === null ? undefined : Number(match[1])
}

/** Date.UTC rolls 30 Feb into March; a round trip shows whether the parts were real. */
function sameParts(ms: number, parts: number[]): boolean {
  const date = new Date(ms)
  const actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ]
  return actual.every((value, index) => value === parts.at(index))
}

function validUtc(raw: string): number | undefined {
  const head = raw.length <= maxLength ? isoHead.exec(raw) : null
  if (head === null) {
    return undefined
  }
  const second = secondsOf(raw.slice(head[0].length))
  const parts = head.slice(1).map(Number)
  const [year = 0, month = 1, day, hour, minute] = parts
  if (second === undefined || second > 59) {
    return undefined
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  return sameParts(ms, parts) ? ms : undefined
}

/** "Choose a time between 12 Oct 2026 and now, in UTC." */
export function chooseTimeMessage(recordStart: number | null): string {
  return recordStart === null
    ? 'Choose a time before now, in UTC.'
    : `Choose a time between ${utcDate(recordStart)} and now, in UTC.`
}

/** "The record starts on 12 Oct 2026, when monitoring began." */
export function beforeRecordMessage(recordStart: number): string {
  return `The record starts on ${utcDate(recordStart)}, when monitoring began.`
}

/**
 * Reads ?at=. Returns null when the address has no ?at=, so the page shows now.
 * A malformed, future or pre-record time gives a problem and the spec's message.
 */
export function parseAt(raw: string | null, limits: AtLimits): AtResult | null {
  if (raw === null) {
    return null
  }
  const parsed = validUtc(raw.trim())
  if (parsed === undefined) {
    return { ok: false, problem: 'invalid', message: chooseTimeMessage(limits.recordStart) }
  }
  const at = floorToMinute(parsed)
  if (at > limits.now) {
    return { ok: false, problem: 'future', message: chooseTimeMessage(limits.recordStart) }
  }
  if (limits.recordStart !== null && at < floorToMinute(limits.recordStart)) {
    return {
      ok: false,
      problem: 'before-record',
      message: beforeRecordMessage(limits.recordStart),
    }
  }
  return { ok: true, at }
}

/** The ?at= value for a moment: "2026-11-02T13:50Z". */
export function atParam(ms: number): string {
  return `${new Date(floorToMinute(ms)).toISOString().slice(0, 16)}Z`
}

/** A link to the page at a moment: "https://status.pralvo.com/?at=2026-11-02T13:50Z". */
export function atLink(origin: string, ms: number): string {
  return `${origin.replace(/\/+$/, '')}/?at=${atParam(ms)}`
}
