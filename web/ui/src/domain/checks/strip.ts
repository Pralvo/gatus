// The check strip (spec 4.1, 9.5 and 10): one slot per kept check, newest on
// the right, failed checks taller, with a sentence for every slot so the
// strip never relies on colour, and the text a screen reader hears.

import type { Result } from '../../api/types'
import { whyFailed, whyText } from '../conditions/why'
import { inOrder, timeOf } from '../status/trend'
import { durationText, nanosToMs, relativeTime, utcClockNear } from '../time/format'

/** The home page shows this many slots per service, as Gatus's 50 result bars did. */
export const stripSlotCount = 50

export type SlotKind = 'passed' | 'failed' | 'none'

export interface Slot {
  kind: SlotKind
  /** Null for an empty slot. */
  result: Result | null
}

/** The newest `count` results, oldest first, with empty slots at the start when fewer are kept. */
export function stripSlots(results: Result[], count = stripSlotCount): Slot[] {
  const kept = inOrder(results).slice(-count)
  const empty: Slot[] = Array.from({ length: Math.max(0, count - kept.length) }, () => ({
    kind: 'none',
    result: null,
  }))
  return [
    ...empty,
    ...kept.map((result): Slot => ({ kind: result.success ? 'passed' : 'failed', result })),
  ]
}

export interface SlotDetails {
  time: string
  result: 'Passed' | 'Failed'
  response: string
  /** Why it failed; null for a passing check. */
  why: string | null
}

/** "No answer" when a failed check gave nothing to time; otherwise the time it took. */
function responseText(result: Result): string {
  if (!result.success && result.duration === 0) {
    return 'No answer'
  }
  return durationText(nanosToMs(result.duration))
}

/** The popover's facts for a slot; null for an empty one. */
export function slotDetails(slot: Slot, reference: number): SlotDetails | null {
  const { result } = slot
  if (result === null) {
    return null
  }
  return {
    time: utcClockNear(timeOf(result), reference),
    result: result.success ? 'Passed' : 'Failed',
    response: responseText(result),
    why: result.success ? null : whyText(whyFailed(result)),
  }
}

export const emptySlotText = 'No check in this slot yet.'

/** The full sentence for a slot: "13:50 UTC: passed in 72 ms." or "13:55 UTC: failed: answered with error 503; ...". */
export function slotSentence(slot: Slot, reference: number): string {
  const details = slotDetails(slot, reference)
  if (details === null) {
    return emptySlotText
  }
  if (details.why === null) {
    return `${details.time}: passed in ${details.response}.`
  }
  return `${details.time}: failed: ${details.why}.`
}

/** "Last 50 checks of Media. Use the arrow keys to read each check." */
export function stripLabel(name: string, slots: Slot[]): string {
  const kept = slots.filter((slot) => slot.result !== null).length
  if (kept === 0) {
    return `Checks of ${name}: none kept yet.`
  }
  const checks = kept === 1 ? 'check' : `${String(kept)} checks`
  return `Last ${checks} of ${name}. Use the arrow keys to read each check.`
}

/** "12 checks since 12:05 UTC: 11 passed, 1 failed, the last at 13:50 UTC." */
export function stripSummary(slots: Slot[], reference: number): string {
  const kept = slots.flatMap((slot) => (slot.result === null ? [] : [slot.result]))
  const [first] = kept
  if (first === undefined) {
    return 'No checks yet.'
  }
  const failed = kept.filter((result) => !result.success)
  const lastFailed = failed.at(-1)
  const checks = kept.length === 1 ? '1 check' : `${String(kept.length)} checks`
  const failures =
    lastFailed === undefined
      ? ''
      : `, ${String(failed.length)} failed, the last at ${utcClockNear(timeOf(lastFailed), reference)}`
  return `${checks} since ${utcClockNear(timeOf(first), reference)}: ${String(kept.length - failed.length)} passed${failures}.`
}

/** The captions under the strip's ends: "4 hours ago" and "now", or "at 13:50 UTC" in time travel. */
export function stripEnds(
  slots: Slot[],
  reference: number,
  past: boolean,
): { first: string; last: string } | null {
  const kept = slots.flatMap((slot) => (slot.result === null ? [] : [timeOf(slot.result)]))
  const [first] = kept
  if (first === undefined) {
    return null
  }
  return {
    first: past ? utcClockNear(first, reference) : relativeTime(first, reference),
    last: past ? `at ${utcClockNear(reference, reference)}` : 'now',
  }
}
