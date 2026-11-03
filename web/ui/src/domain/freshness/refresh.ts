// The minute refresh cycle in words (spec 4.1, 8 and 9.2): how fresh the page
// is, what to say when a refresh fails, and when to try again.

import { minuteMs, relativeTime, utcClock, utcClockNear } from '../time/format'

import { isStale } from './staleness'

export const refreshEveryMs = minuteMs
/** After this many failed refreshes in a row, the cycle slows down. */
export const backoffAfterFailures = 3
export const backoffEveryMs = 5 * minuteMs

/** How long to wait before the next refresh, given failed refreshes in a row. */
export function refreshDelayMs(failuresInRow: number): number {
  return failuresInRow >= backoffAfterFailures ? backoffEveryMs : refreshEveryMs
}

export interface RefreshState {
  /** When the minute cycle last succeeded; null before the first success. */
  lastSuccessAt: number | null
  /** Failed refreshes since the last success. */
  failuresInRow: number
}

/**
 * "Couldn't refresh. Showing data from 14:05 UTC. Trying again in 1 minute."
 * Null while the latest refresh succeeded, or before any data has loaded,
 * which the page shows as "Status unavailable" instead.
 */
export function refreshFailedMessage(state: RefreshState, now: number): string | null {
  if (state.failuresInRow === 0 || state.lastSuccessAt === null) {
    return null
  }
  const wait = refreshDelayMs(state.failuresInRow) / minuteMs
  return `Couldn't refresh. Showing data from ${utcClockNear(state.lastSuccessAt, now)}. Trying again in ${String(wait)} ${wait === 1 ? 'minute' : 'minutes'}.`
}

/** The partial-failure warning: checks loaded, reports or maintenance did not. */
export const noticesFailedMessage =
  'Reports and maintenance could not be loaded. Service checks below are current.'

/**
 * The freshness text beside the answer: "Updated 1 minute ago · refreshes every
 * minute", or "Newest check 24 minutes ago" when the monitor looks stopped.
 */
export function freshnessText(
  lastSuccessAt: number | null,
  newestCheck: number | null,
  now: number,
): string | null {
  if (newestCheck !== null && isStale(newestCheck, now)) {
    return `Newest check ${relativeTime(newestCheck, now)}`
  }
  if (lastSuccessAt === null) {
    return null
  }
  return `Updated ${relativeTime(lastSuccessAt, now)} · refreshes every minute`
}

/** For "About this page": "1 minute ago, at 14:04 UTC. If no check arrives for 15 minutes, ..." */
export function newestCheckText(newestCheck: number | null, now: number): string {
  const rule = 'If no check arrives for 15 minutes, this page says it may be out of date.'
  if (newestCheck === null) {
    return `No check has finished yet. ${rule}`
  }
  const when =
    utcClock(newestCheck) === utcClockNear(newestCheck, now)
      ? `at ${utcClock(newestCheck)}`
      : `on ${utcClockNear(newestCheck, now)}`
  return `${relativeTime(newestCheck, now)}, ${when}. ${rule}`
}
