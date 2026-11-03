import { describe, expect, it } from 'vitest'

import { at, event } from '../../test/fixtures'

import { historyItems } from './history'

describe('historyItems', () => {
  const events = [
    event('START', -3000),
    event('HEALTHY', -2995),
    event('UNHEALTHY', 40),
    event('HEALTHY', 62),
    event('UNHEALTHY', 80),
  ]

  it('tells each event, newest first', () => {
    expect(historyItems(events, at(90)).map((item) => [item.at, item.kind, item.text])).toEqual([
      [at(80), 'failed', 'Checks began failing.'],
      [at(62), 'passed', 'Checks passed again, after 22 minutes of failed checks.'],
      [at(40), 'failed', 'Checks began failing.'],
      [at(-2995), 'passed', 'Checks passed.'],
      [at(-3000), 'start', 'Monitoring began.'],
    ])
  })

  it('stops at the moment, for time travel', () => {
    expect(historyItems(events, at(50)).map((item) => item.at)).toEqual([
      at(40),
      at(-2995),
      at(-3000),
    ])
  })

  it('gives nothing without events, and skips unreadable times', () => {
    expect(historyItems(undefined, at(0))).toEqual([])
    expect(historyItems([{ type: 'UNHEALTHY', timestamp: 'not a time' }], at(0))).toEqual([])
  })
})
