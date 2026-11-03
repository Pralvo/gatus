import { describe, expect, it } from 'vitest'

import { at, result, results } from '../../test/fixtures'

import { freshnessText, newestCheckText, refreshDelayMs, refreshFailedMessage } from './refresh'
import { asOfPrefix, isLate, isStale, newestCheckAt, usualGapMs } from './staleness'

describe('staleness', () => {
  it('finds the usual gap as the median gap', () => {
    expect(usualGapMs(results(6, { last: 60, every: 10 }))).toBe(600_000)
    expect(usualGapMs([result({ minute: 0 })])).toBeNull()
    expect(usualGapMs([])).toBeNull()
  })

  it('calls a check late after twice its usual gap', () => {
    const every10 = results(6, { last: 60, every: 10 })
    expect(isLate(every10, at(80))).toBe(false)
    expect(isLate(every10, at(81))).toBe(true)
    expect(isLate([result({ minute: 0 })], at(999))).toBe(false)
  })

  it('finds the newest check across services', () => {
    expect(
      newestCheckAt([{ results: results(2, { last: 30 }) }, { results: results(2, { last: 41 }) }]),
    ).toBe(at(41))
    expect(newestCheckAt([{ results: [] }])).toBeNull()
  })

  it('calls the page stale after 15 minutes without a check', () => {
    expect(isStale(at(41), at(56))).toBe(false)
    expect(isStale(at(41), at(56) + 1)).toBe(true)
    expect(isStale(null, at(56))).toBe(false)
  })

  it('writes the as-of prefix', () => {
    expect(asOfPrefix(at(41), at(65))).toBe('As of 13:41 UTC (our newest check), ')
  })
})

describe('refresh', () => {
  it('backs off to 5 minutes after 3 failures in a row', () => {
    expect(refreshDelayMs(0)).toBe(60_000)
    expect(refreshDelayMs(2)).toBe(60_000)
    expect(refreshDelayMs(3)).toBe(300_000)
  })

  it('says when a refresh failed and when it tries again', () => {
    expect(refreshFailedMessage({ lastSuccessAt: at(65), failuresInRow: 1 }, at(66))).toBe(
      "Couldn't refresh. Showing data from 14:05 UTC. Trying again in 1 minute.",
    )
    expect(refreshFailedMessage({ lastSuccessAt: at(65), failuresInRow: 3 }, at(68))).toBe(
      "Couldn't refresh. Showing data from 14:05 UTC. Trying again in 5 minutes.",
    )
  })

  it('says nothing after a success or before any data', () => {
    expect(refreshFailedMessage({ lastSuccessAt: at(65), failuresInRow: 0 }, at(66))).toBeNull()
    expect(refreshFailedMessage({ lastSuccessAt: null, failuresInRow: 4 }, at(66))).toBeNull()
  })

  it('writes the freshness text, or the newest check when stale', () => {
    expect(freshnessText(at(64), at(63), at(65))).toBe(
      'Updated 1 minute ago · refreshes every minute',
    )
    expect(freshnessText(at(65), at(41), at(65))).toBe('Newest check 24 minutes ago')
    expect(freshnessText(null, null, at(65))).toBeNull()
  })

  it('writes the newest check for the about section', () => {
    expect(newestCheckText(at(64), at(65))).toBe(
      '1 minute ago, at 14:04 UTC. If no check arrives for 15 minutes, this page says it may be out of date.',
    )
    expect(newestCheckText(at(64), at(65 + 24 * 60))).toMatch(
      /^24 hours ago, on 2 Nov, 14:04 UTC\./,
    )
    expect(newestCheckText(null, at(65))).toMatch(/^No check has finished yet\./)
  })
})
