import { describe, expect, it } from 'vitest'

import { at, result, results } from '../../test/fixtures'

import {
  compareWithNormal,
  comparisonText,
  inOrder,
  median,
  trendOf,
  trendText,
  usualFromHistory,
} from './trend'

const now = at(70)

function pattern(oks: boolean[]) {
  return oks.map((ok, index) => result({ minute: index * 5, ok }))
}

describe('trend', () => {
  it.each([
    [[true, true, true, true, true, true, true], 'Steady'],
    [[true, true, true, false, false, false], 'Failed its last 3 checks, since 13:15 UTC'],
    [[true, true, true, true, true, false], 'Its latest check, at 13:25 UTC, failed'],
    [
      [true, true, false, false, true, true],
      'Recovering: the last 2 checks passed after 2 failures',
    ],
    [[true, true, true, true, false, true], 'Recovering: the latest check passed after 1 failure'],
    [[false, true, false, true, true, true], 'Unsteady: 2 of the last 6 checks failed'],
    [[true, false, false, true, false, true], 'Unsteady: 3 of the last 6 checks failed'],
    [[false, false, true, true, true, true, true, true], 'Steady'],
  ])('reads %j as %s', (oks, words) => {
    expect(trendText(trendOf(pattern(oks)), now)).toBe(words)
  })

  it('says when a service has no checks yet', () => {
    expect(trendOf([])).toEqual({ kind: 'none' })
    expect(trendText({ kind: 'none' }, now)).toBe('No checks yet')
  })

  it('sorts results by time and drops unreadable times', () => {
    const shuffled = [
      result({ minute: 10 }),
      result({ minute: 0 }),
      { ...result({ minute: 5 }), timestamp: 'x' },
    ]
    expect(inOrder(shuffled).map((item) => item.timestamp)).toEqual([
      new Date(at(0)).toISOString(),
      new Date(at(10)).toISOString(),
    ])
  })

  it('adds the day to a clock time from another day', () => {
    const trend = trendOf(pattern([false, false]))
    expect(trendText(trend, at(24 * 60))).toBe('Failed its last 2 checks, since 2 Nov, 13:00 UTC')
  })
})

describe('median and usual', () => {
  it('finds the middle', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(median([Number.NaN])).toBeNull()
  })

  it('takes the usual time from hourly history, ignoring empty hours', () => {
    expect(usualFromHistory({ timestamps: [1, 2, 3, 4], values: [0, 60, 70, 80] })).toBe(70)
    expect(usualFromHistory({ timestamps: [], values: [] })).toBeNull()
    expect(usualFromHistory(undefined)).toBeNull()
  })
})

describe('compared with normal', () => {
  it.each([
    [72, 70, 'As fast as usual: 72 ms now, 70 ms usually.'],
    [105, 70, 'Slower than usual: 105 ms now, 70 ms usually.'],
    [104, 70, 'As fast as usual: 104 ms now, 70 ms usually.'],
    [1200, 70, 'Much slower than usual: 1.2 s now, 70 ms usually.'],
    [209, 70, 'Slower than usual: 209 ms now, 70 ms usually.'],
    [210, 70, 'Much slower than usual: 210 ms now, 70 ms usually.'],
  ])('compares %s ms with %s ms', (ms, usual, words) => {
    expect(comparisonText(compareWithNormal(results(5, { last: 60, ms }), usual))).toBe(words)
  })

  it('uses the median of the last 3 passing checks only', () => {
    const mixed = [
      result({ minute: 0, ms: 5000 }),
      result({ minute: 5, ms: 60 }),
      result({ minute: 10, ms: 80 }),
      result({ minute: 15, ok: false, ms: 9000 }),
      result({ minute: 20, ms: 70 }),
    ]
    expect(compareWithNormal(mixed, 70)).toMatchObject({ kind: 'usual', nowMs: 70, ratio: 1 })
  })

  it('needs 3 passing checks and a usual time', () => {
    expect(comparisonText(compareWithNormal(results(2, { last: 60 }), 70))).toBe(
      'Not enough checks to compare.',
    )
    expect(compareWithNormal(results(5, { last: 60 }), null).kind).toBe('not-enough')
    expect(compareWithNormal(results(5, { last: 60 }), 0).kind).toBe('not-enough')
    expect(compareWithNormal([], 70).kind).toBe('not-enough')
  })

  it('says when a check does not measure response time', () => {
    expect(comparisonText(compareWithNormal(results(5, { last: 60, ms: 0 }), 70))).toBe(
      'This check does not measure response time.',
    )
  })
})
