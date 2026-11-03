import { describe, expect, it } from 'vitest'

import { at, result, results } from '../../test/fixtures'

import {
  emptySlotText,
  slotDetails,
  slotSentence,
  stripEnds,
  stripLabel,
  stripSlots,
  stripSummary,
} from './strip'

const now = at(61)

describe('stripSlots', () => {
  it('keeps the newest checks, oldest first, and pads the start with empty slots', () => {
    const slots = stripSlots(results(3, { last: 60, failing: [55] }), 5)
    expect(slots.map((slot) => slot.kind)).toEqual(['none', 'none', 'passed', 'failed', 'passed'])
  })

  it('drops the oldest checks beyond the slot count', () => {
    const slots = stripSlots(results(8, { last: 60, failing: [25] }), 4)
    expect(slots.map((slot) => slot.kind)).toEqual(['passed', 'passed', 'passed', 'passed'])
  })
})

describe('slot words', () => {
  it('describes a passed check', () => {
    const [slot] = stripSlots([result({ minute: 50, ms: 72 })], 1)
    expect(slot && slotDetails(slot, now)).toEqual({
      time: '13:50 UTC',
      result: 'Passed',
      response: '72 ms',
      why: null,
    })
    expect(slot && slotSentence(slot, now)).toBe('13:50 UTC: passed in 72 ms.')
  })

  it('describes a failed check with its reason', () => {
    const [slot] = stripSlots([result({ minute: 55, ok: false })], 1)
    expect(slot && slotSentence(slot, now)).toBe(
      '13:55 UTC: failed: answered with error 503; it needs a code below 500.',
    )
  })

  it('says "No answer" when a failed check took no time', () => {
    const [slot] = stripSlots([result({ minute: 55, ok: false, ms: 0, errors: ['refused'] })], 1)
    expect(slot && slotDetails(slot, now)?.response).toBe('No answer')
  })

  it('names an empty slot', () => {
    const [slot] = stripSlots([], 1)
    expect(slot && slotDetails(slot, now)).toBeNull()
    expect(slot && slotSentence(slot, now)).toBe(emptySlotText)
  })
})

describe('strip text', () => {
  it('labels and sums up the strip', () => {
    const slots = stripSlots(results(12, { last: 60, failing: [50] }), 50)
    expect(stripLabel('Media', slots)).toBe(
      'Last 12 checks of Media. Use the arrow keys to read each check.',
    )
    expect(stripSummary(slots, now)).toBe(
      '12 checks since 13:05 UTC: 11 passed, 1 failed, the last at 13:50 UTC.',
    )
  })

  it('handles one check and none', () => {
    const one = stripSlots(results(1, { last: 60 }), 50)
    expect(stripLabel('Media', one)).toBe(
      'Last check of Media. Use the arrow keys to read each check.',
    )
    expect(stripSummary(one, now)).toBe('1 check since 14:00 UTC: 1 passed.')
    expect(stripLabel('Media', stripSlots([], 3))).toBe('Checks of Media: none kept yet.')
    expect(stripSummary(stripSlots([], 3), now)).toBe('No checks yet.')
  })

  it('captions the ends, now or at a past moment', () => {
    const slots = stripSlots(results(12, { last: 60 }), 50)
    expect(stripEnds(slots, now, false)).toEqual({ first: '56 minutes ago', last: 'now' })
    expect(stripEnds(slots, at(60), true)).toEqual({ first: '13:05 UTC', last: 'at 14:00 UTC' })
    expect(stripEnds(stripSlots([], 2), now, false)).toBeNull()
  })
})
