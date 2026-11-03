// The trend line and "compared with normal" for one service (spec section 7).
// Results go in oldest first; times are Unix milliseconds.

import type { ResponseTimeHistory, Result } from '../../api/types'
import { durationText, nanosToMs, utcClockNear } from '../time/format'

/** The newest results this many deep feed the trend. */
export const trendDepth = 6
/** Now is the median of this many latest passing durations. */
export const nowDepth = 3

export type Trend =
  | { kind: 'none' }
  | { kind: 'steady' }
  | { kind: 'failing'; run: number; since: number; latestAt: number }
  | { kind: 'recovering'; passed: number; failures: number }
  | { kind: 'unsteady'; failures: number }

export function timeOf(result: Result): number {
  return Date.parse(result.timestamp)
}

/** Results with a readable time, oldest first. */
export function inOrder(results: Result[]): Result[] {
  return results
    .filter((result) => Number.isFinite(timeOf(result)))
    .sort((a, b) => timeOf(a) - timeOf(b))
}

/** How many of the newest results failed in a row. */
export function failingRun(ordered: Result[]): number {
  let run = 0
  for (
    let index = ordered.length - 1;
    index >= 0 && ordered.at(index)?.success === false;
    index--
  ) {
    run++
  }
  return run
}

/** The trend from the newest results: steady, failing, recovering or unsteady. */
export function trendOf(ordered: Result[]): Trend {
  const latest = ordered.at(-1)
  if (latest === undefined) {
    return { kind: 'none' }
  }
  const run = failingRun(ordered)
  if (run > 0) {
    const first = ordered.at(-run) ?? latest
    return { kind: 'failing', run, since: timeOf(first), latestAt: timeOf(latest) }
  }
  const recent = ordered.slice(-trendDepth)
  const failures = recent.filter((result) => !result.success).length
  if (failures === 0) {
    return { kind: 'steady' }
  }
  let passed = 0
  while (recent.at(recent.length - 1 - passed)?.success === true) {
    passed++
  }
  let block = 0
  while (recent.at(recent.length - 1 - passed - block)?.success === false) {
    block++
  }
  // Recovering: the failures form one run just before the passing run. Otherwise mixed.
  return block === failures
    ? { kind: 'recovering', passed, failures }
    : { kind: 'unsteady', failures }
}

function count(amount: number, one: string, many: string): string {
  return `${String(amount)} ${amount === 1 ? one : many}`
}

/** The trend in words. `reference` is now, or the time-travel moment, for the clock times. */
export function trendText(trend: Trend, reference: number): string {
  switch (trend.kind) {
    case 'steady':
      return 'Steady'
    case 'failing':
      return trend.run === 1
        ? `Its latest check, at ${utcClockNear(trend.latestAt, reference)}, failed`
        : `Failed its last ${String(trend.run)} checks, since ${utcClockNear(trend.since, reference)}`
    case 'recovering':
      return trend.passed === 1
        ? `Recovering: the latest check passed after ${count(trend.failures, 'failure', 'failures')}`
        : `Recovering: the last ${String(trend.passed)} checks passed after ${count(trend.failures, 'failure', 'failures')}`
    case 'unsteady':
      return `Unsteady: ${String(trend.failures)} of the last ${String(trendDepth)} checks failed`
    default:
      return 'No checks yet'
  }
}

/** The middle value; the mean of the two middle values for an even count. */
export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) {
    return null
  }
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted.at(middle) ?? 0
  return sorted.length % 2 === 1 ? upper : ((sorted.at(middle - 1) ?? upper) + upper) / 2
}

/** The usual response time: the median of the 7-day hourly history, in milliseconds. */
export function usualFromHistory(history: ResponseTimeHistory | undefined): number | null {
  const usual = median((history?.values ?? []).filter((value) => value > 0))
  return usual === null || usual <= 0 ? null : usual
}

export type ComparisonKind = 'usual' | 'slower' | 'much-slower' | 'not-enough' | 'not-measured'

export interface Comparison {
  kind: ComparisonKind
  /** Median of the latest passing durations, in milliseconds. */
  nowMs: number | null
  usualMs: number | null
  ratio: number | null
}

/** Whether a comparison counts as slower than usual. */
export function isSlow(comparison: Comparison): boolean {
  return comparison.kind === 'slower' || comparison.kind === 'much-slower'
}

/**
 * Compares the median of the last 3 passing durations with the usual time:
 * below 1.5 times is usual, 1.5 to 3 is slower, 3 or more is much slower.
 * A check whose durations are all 0 does not measure response time.
 */
export function compareWithNormal(ordered: Result[], usualMs: number | null): Comparison {
  if (ordered.length > 0 && ordered.every((result) => result.duration === 0)) {
    return { kind: 'not-measured', nowMs: null, usualMs, ratio: null }
  }
  const passing = ordered.filter((result) => result.success).slice(-nowDepth)
  const nowMs =
    passing.length < nowDepth ? null : median(passing.map((result) => nanosToMs(result.duration)))
  if (nowMs === null || usualMs === null || usualMs <= 0) {
    return { kind: 'not-enough', nowMs, usualMs, ratio: null }
  }
  const ratio = nowMs / usualMs
  let kind: ComparisonKind = 'usual'
  if (ratio >= 3) {
    kind = 'much-slower'
  } else if (ratio >= 1.5) {
    kind = 'slower'
  }
  return { kind, nowMs, usualMs, ratio }
}

/** "72 ms now, 70 ms usually" */
export function speedPair(comparison: Comparison, nowWord = 'now'): string {
  return `${durationText(comparison.nowMs ?? 0)} ${nowWord}, ${durationText(comparison.usualMs ?? 0)} usually`
}

/** The comparison in words, as in the spec table. */
export function comparisonText(comparison: Comparison): string {
  switch (comparison.kind) {
    case 'usual':
      return `As fast as usual: ${speedPair(comparison)}.`
    case 'slower':
      return `Slower than usual: ${speedPair(comparison)}.`
    case 'much-slower':
      return `Much slower than usual: ${speedPair(comparison)}.`
    case 'not-measured':
      return 'This check does not measure response time.'
    default:
      return 'Not enough checks to compare.'
  }
}
