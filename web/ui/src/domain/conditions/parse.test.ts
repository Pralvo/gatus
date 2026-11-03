import { describe, expect, it } from 'vitest'

import { result } from '../../test/fixtures'

import { conditionsOf, goDurationMs, parseCondition, wholeNumber } from './parse'

describe('parseCondition', () => {
  it('reads a passing condition', () => {
    expect(parseCondition('[STATUS] == 200')).toEqual({
      raw: '[STATUS] == 200',
      placeholder: 'STATUS',
      seen: null,
      operator: '==',
      expected: '200',
    })
  })

  it('reads the value a failing condition saw', () => {
    expect(parseCondition('[RESPONSE_TIME] (6200) <= 5000')).toMatchObject({
      placeholder: 'RESPONSE_TIME',
      seen: '6200',
      operator: '<=',
      expected: '5000',
    })
  })

  it.each([
    '[BODY].status == UP',
    'len([BODY].items) > 0',
    '[STATUS] ~= 200',
    '[STATUS]==200',
    '',
    '<img src=x onerror=alert(1)>',
  ])('returns null for %s', (raw) => {
    expect(parseCondition(raw)).toBeNull()
  })
})

describe('numbers and durations', () => {
  it('reads whole numbers only', () => {
    expect(wholeNumber('503')).toBe(503)
    expect(wholeNumber('any(200, 201)')).toBeNull()
    expect(wholeNumber('1e3')).toBeNull()
    expect(wholeNumber(null)).toBeNull()
  })

  it.each([
    ['168h', 168 * 3_600_000],
    ['119h59m30s', 119 * 3_600_000 + 59 * 60_000 + 30_000],
    ['1.5h', 5_400_000],
    ['250ms', 250],
    ['-5h', -5 * 3_600_000],
    ['0', 0],
    ['0s', 0],
  ])('reads Go duration %s', (text, ms) => {
    expect(goDurationMs(text)).toBe(ms)
  })

  it.each(['', 'h', '5x', '3h5', '5 days', 'h5'])('refuses %s', (text) => {
    expect(goDurationMs(text)).toBeNull()
  })
})

describe('conditionsOf', () => {
  it('strips the seen values so the conditions read as written', () => {
    const failing = result({
      minute: 0,
      ok: false,
      conditions: [
        { condition: '[STATUS] (503) == 200', success: false },
        { condition: '[BODY].status == UP', success: true },
      ],
    })
    expect(conditionsOf(failing)).toEqual(['[STATUS] == 200', '[BODY].status == UP'])
  })

  it('gives nothing for a missing result', () => {
    expect(conditionsOf(undefined)).toEqual([])
  })
})
