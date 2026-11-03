import { describe, expect, it } from 'vitest'

import { atLink, atParam, parseAt } from './at'

const now = Date.UTC(2026, 10, 3, 14, 5, 30)
const recordStart = Date.UTC(2026, 9, 12, 9, 0)
const limits = { now, recordStart }

describe('parseAt', () => {
  it('gives null when there is no ?at=', () => {
    expect(parseAt(null, limits)).toBeNull()
  })

  it.each([
    '2026-11-02T13:50Z',
    '2026-11-02T13:50:59Z',
    '2026-11-02T13:50:59.999Z',
    '2026-11-02T13:50',
    '2026-11-02T13:50:00+00:00',
  ])('reads %s as 13:50 UTC, rounded down to the minute', (raw) => {
    expect(parseAt(raw, limits)).toEqual({ ok: true, at: Date.UTC(2026, 10, 2, 13, 50) })
  })

  it.each([
    '',
    'yesterday',
    '2026-11-02',
    '2026-11-02T13:50+05:30',
    '2026-02-30T10:00Z',
    '2026-11-02T25:00Z',
    '2026-11-02T13:50Z<script>',
    `2026-11-02T13:50:00.${'9'.repeat(60)}Z`,
  ])('refuses %s with the choose-a-time message', (raw) => {
    expect(parseAt(raw, limits)).toEqual({
      ok: false,
      problem: 'invalid',
      message: 'Choose a time between 12 Oct 2026 and now, in UTC.',
    })
  })

  it('refuses a future time', () => {
    expect(parseAt('2026-11-03T14:06Z', limits)).toMatchObject({ ok: false, problem: 'future' })
  })

  it('accepts the current minute', () => {
    expect(parseAt('2026-11-03T14:05:59Z', limits)).toEqual({
      ok: true,
      at: Date.UTC(2026, 10, 3, 14, 5),
    })
  })

  it('refuses a time before the record with its own message', () => {
    expect(parseAt('2026-10-11T23:00Z', limits)).toEqual({
      ok: false,
      problem: 'before-record',
      message: 'The record starts on 12 Oct 2026, when monitoring began.',
    })
  })

  it('skips the record check while the record start is unknown', () => {
    expect(parseAt('2020-01-01T00:00Z', { now, recordStart: null })).toMatchObject({ ok: true })
    expect(parseAt('nonsense', { now, recordStart: null })).toMatchObject({
      message: 'Choose a time before now, in UTC.',
    })
  })
})

describe('links', () => {
  it('writes the minute in UTC and builds the link', () => {
    expect(atParam(Date.UTC(2026, 10, 2, 13, 50, 42))).toBe('2026-11-02T13:50Z')
    expect(atLink('https://status.pralvo.com/', Date.UTC(2026, 10, 2, 13, 50))).toBe(
      'https://status.pralvo.com/?at=2026-11-02T13:50Z',
    )
  })
})
