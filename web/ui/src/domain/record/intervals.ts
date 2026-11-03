// Failure periods from Gatus events. Events keep when each service started and
// stopped failing long after the check details are gone, so the record, the
// report story and time travel all read them.

import type { StatusEvent } from '../../api/types'

export interface Interval {
  start: number
  /** The end, or the `until` time while the failure was still open then. */
  end: number
  /** Still failing at `until`. */
  open: boolean
}

interface TimedEvent {
  type: StatusEvent['type']
  at: number
}

/** Events with a readable time, oldest first. */
export function timedEvents(events: StatusEvent[] | undefined): TimedEvent[] {
  return (events ?? [])
    .map((event) => ({ type: event.type, at: Date.parse(event.timestamp) }))
    .filter((event) => Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at)
}

/**
 * Failure periods up to `until`: each runs from an UNHEALTHY event to the next
 * HEALTHY or START event. Events after `until` are ignored, so a failure that
 * was open then stays open.
 */
export function failureIntervals(events: StatusEvent[] | undefined, until: number): Interval[] {
  const intervals: Interval[] = []
  let start: number | null = null
  for (const event of timedEvents(events)) {
    if (event.at > until) {
      break
    }
    if (event.type === 'UNHEALTHY' && start === null) {
      start = event.at
    } else if (event.type !== 'UNHEALTHY' && start !== null) {
      intervals.push({ start, end: event.at, open: false })
      start = null
    }
  }
  if (start !== null) {
    intervals.push({ start, end: until, open: true })
  }
  return intervals
}

/** How much of an interval falls inside [from, to), in milliseconds. */
export function overlapMs(
  interval: { start: number; end: number },
  from: number,
  to: number,
): number {
  return Math.max(0, Math.min(interval.end, to) - Math.max(interval.start, from))
}

/** The state at a moment from the last event at or before it; null before the first event. */
export function stateAt(events: StatusEvent[] | undefined, moment: number): TimedEvent | null {
  let last: TimedEvent | null = null
  for (const event of timedEvents(events)) {
    if (event.at > moment) {
      break
    }
    last = event
  }
  return last
}

/**
 * When monitoring began: the earliest START event of any service, or the
 * earliest event when no START is kept. Null when no events are loaded.
 */
export function recordStart(eventLists: (StatusEvent[] | undefined)[]): number | null {
  const all = eventLists.flatMap((events) => timedEvents(events))
  const starts = all.filter((event) => event.type === 'START')
  const pool = starts.length > 0 ? starts : all
  return pool.length === 0 ? null : Math.min(...pool.map((event) => event.at))
}
