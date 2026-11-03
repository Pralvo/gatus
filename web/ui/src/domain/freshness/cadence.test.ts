import { describe, expect, it } from 'vitest'

import { results } from '../../test/fixtures'
import { minuteMs, secondMs } from '../time/format'

import { everyText, howOftenText, listNames, roundedGap } from './cadence'

describe('roundedGap', () => {
  it.each([
    [30 * secondMs, { amount: 30, unit: 'second' }],
    [5 * minuteMs + 4 * secondMs, { amount: 5, unit: 'minute' }],
    [59 * minuteMs + 40 * secondMs, { amount: 1, unit: 'hour' }],
    [150 * minuteMs, { amount: 3, unit: 'hour' }],
    [200, { amount: 1, unit: 'second' }],
  ])('%d ms is %o', (ms, gap) => {
    expect(roundedGap(ms)).toEqual(gap)
  })
})

describe('everyText', () => {
  it('drops the count for one and the unit when asked', () => {
    expect(everyText({ amount: 1, unit: 'minute' })).toBe('about every minute')
    expect(everyText({ amount: 5, unit: 'minute' })).toBe('about every 5 minutes')
    expect(everyText({ amount: 10, unit: 'minute' }, false)).toBe('about every 10')
  })
})

describe('listNames', () => {
  it('names everyone', () => {
    expect(listNames([])).toBe('')
    expect(listNames(['Website'])).toBe('Website')
    expect(listNames(['Website', 'Blog'])).toBe('Website and Blog')
    expect(listNames(['Website', 'Blog', 'Media'])).toBe('Website, Blog and Media')
  })
})

describe('howOftenText', () => {
  it('groups services with the same gap, shortest first', () => {
    const text = howOftenText([
      { name: 'Database', results: results(4, { last: 90, every: 30 }) },
      { name: 'Website', results: results(6, { last: 60, every: 5 }) },
      { name: 'Content system', results: results(6, { last: 60, every: 10 }) },
      { name: 'Blog', results: results(6, { last: 61, every: 5 }) },
      { name: 'Media', results: results(6, { last: 62, every: 10 }) },
    ])
    expect(text).toBe(
      'Website and Blog about every 5 minutes, Content system and Media about every 10, Database about every 30.',
    )
  })

  it('reads the median gap, so one late check does not change the wording', () => {
    const steady = results(6, { last: 60, every: 5 })
    const late = [...steady, ...results(1, { last: 90 })]
    expect(howOftenText([{ name: 'Website', results: late }])).toBe(
      'Website about every 5 minutes.',
    )
  })

  it('keeps the unit when it changes between groups', () => {
    const text = howOftenText([
      { name: 'Website', results: results(4, { last: 60, every: 5 }) },
      { name: 'Backup', results: results(3, { last: 600, every: 120 }) },
    ])
    expect(text).toBe('Website about every 5 minutes, Backup about every 2 hours.')
  })

  it('says when a service has too few checks to tell', () => {
    expect(
      howOftenText([
        { name: 'Website', results: results(3, { last: 60, every: 5 }) },
        { name: 'Blog', results: results(1, { last: 60 }) },
        { name: 'Media', results: [] },
      ]),
    ).toBe('Website about every 5 minutes. Blog and Media: not enough checks yet to tell.')
    expect(howOftenText([{ name: 'Media', results: [] }])).toBe(
      'Media: not enough checks yet to tell.',
    )
  })

  it('gives nothing without services', () => {
    expect(howOftenText([])).toBeNull()
  })
})
