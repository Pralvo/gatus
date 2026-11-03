// Staleness (spec 9.2). A service's check is late when its newest result is
// older than twice its usual gap. The whole page may be out of date when the
// newest check of any service is older than 15 minutes.

import type { Result } from '../../api/types'
import { median, timeOf } from '../status/trend'
import { minuteMs, utcClockNear } from '../time/format'

/** The page is stale when its newest check is older than this. */
export const staleAfterMs = 15 * minuteMs

/** The median gap between a service's results, or null with fewer than two. */
export function usualGapMs(ordered: Result[]): number | null {
  const gaps: number[] = []
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered.at(index - 1)
    const current = ordered.at(index)
    if (previous !== undefined && current !== undefined) {
      gaps.push(timeOf(current) - timeOf(previous))
    }
  }
  const gap = median(gaps.filter((value) => value > 0))
  return gap === null || gap <= 0 ? null : gap
}

/** Whether a service's newest check is older than twice its usual gap. Unknown gap: not late. */
export function isLate(ordered: Result[], now: number): boolean {
  const newest = ordered.at(-1)
  const gap = usualGapMs(ordered)
  return newest !== undefined && gap !== null && now - timeOf(newest) > 2 * gap
}

/** The newest check time across services, or null when none has a result. */
export function newestCheckAt(services: { results: Result[] }[]): number | null {
  let newest: number | null = null
  for (const service of services) {
    for (const result of service.results) {
      const time = timeOf(result)
      if (Number.isFinite(time) && (newest === null || time > newest)) {
        newest = time
      }
    }
  }
  return newest
}

/** Whether the monitor looks stopped: its newest check is older than 15 minutes. */
export function isStale(newest: number | null, now: number): boolean {
  return newest !== null && now - newest > staleAfterMs
}

/** "As of 13:41 UTC (our newest check), " to put before a detail line when stale. */
export function asOfPrefix(newest: number, now: number): string {
  return `As of ${utcClockNear(newest, now)} (our newest check), `
}
