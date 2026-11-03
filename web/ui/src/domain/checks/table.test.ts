import { describe, expect, it } from 'vitest'

import { at, result, results } from '../../test/fixtures'

import { checkRows, hasOlderPage, pageCaption } from './table'

describe('checkRows', () => {
  it('lists checks newest first, with why each failed', () => {
    const rows = checkRows(
      [
        result({ minute: 50 }),
        result({ minute: 60, ok: false, errors: ['context deadline exceeded'], ms: 30_000 }),
        result({ minute: 55, ok: false, ms: 0 }),
      ],
      at(61),
    )
    expect(rows).toEqual([
      {
        at: at(60),
        time: '14:00 UTC',
        result: 'Failed',
        response: '30 s',
        why: 'no answer within 30 seconds',
      },
      {
        at: at(55),
        time: '13:55 UTC',
        result: 'Failed',
        response: 'No answer',
        why: 'answered with error 503; it needs a code below 500',
      },
      { at: at(50), time: '13:50 UTC', result: 'Passed', response: '70 ms', why: null },
    ])
  })

  it('leaves out checks after the time-travel moment', () => {
    expect(checkRows(results(5, { last: 60 }), at(50)).map((row) => row.time)).toEqual([
      '13:50 UTC',
      '13:45 UTC',
      '13:40 UTC',
    ])
  })
})

describe('paging', () => {
  it('offers older checks only when this page is full and more are kept', () => {
    expect(hasOlderPage(1, 50, 100)).toBe(true)
    expect(hasOlderPage(2, 50, 100)).toBe(false)
    expect(hasOlderPage(1, 12, 100)).toBe(false)
  })

  it('says which checks the page shows', () => {
    expect(pageCaption(1, 50)).toBe('Checks 1 to 50, newest first.')
    expect(pageCaption(2, 7)).toBe('Checks 51 to 57, newest first.')
    expect(pageCaption(1, 1)).toBe('Check 1, the newest on this page.')
    expect(pageCaption(1, 0)).toBe('No checks are kept yet.')
    expect(pageCaption(3, 0)).toBe('No older checks are kept.')
  })
})
