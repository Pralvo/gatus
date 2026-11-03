import { describe, expect, it } from 'vitest'

import {
  durationText,
  localTime,
  minutesText,
  relativeTime,
  startOfUtcDay,
  utcClock,
  utcClockNear,
  utcDate,
  utcDateTime,
  utcDay,
} from './format'

const t = Date.UTC(2026, 10, 2, 13, 50, 42)

describe('UTC wording', () => {
  it('writes clock, day, date and date-time', () => {
    expect(utcClock(t)).toBe('13:50 UTC')
    expect(utcDay(t)).toBe('2 Nov')
    expect(utcDate(t)).toBe('2 Nov 2026')
    expect(utcDateTime(t)).toBe('2 Nov 2026, 13:50 UTC')
    expect(utcClock(Date.UTC(2026, 0, 5, 4, 3))).toBe('04:03 UTC')
  })

  it('adds the day only when the time is on another UTC day', () => {
    expect(utcClockNear(t, Date.UTC(2026, 10, 2, 23, 59))).toBe('13:50 UTC')
    expect(utcClockNear(t, Date.UTC(2026, 10, 3, 0, 1))).toBe('2 Nov, 13:50 UTC')
  })

  it('finds midnight UTC', () => {
    expect(startOfUtcDay(t)).toBe(Date.UTC(2026, 10, 2))
  })
})

describe('relativeTime', () => {
  const now = Date.UTC(2026, 11, 1, 12)
  it.each([
    [now - 20_000, 'just now'],
    [now - 60_000, '1 minute ago'],
    [now - 2 * 60_000, '2 minutes ago'],
    [now - 90 * 60_000, '2 hours ago'],
    [now - 47 * 3_600_000, '47 hours ago'],
    [now - 4 * 86_400_000, '4 days ago'],
    [now + 5 * 60_000, 'in 5 minutes'],
  ])('says %s as %s', (when, words) => {
    expect(relativeTime(when, now)).toBe(words)
  })
})

describe('minutesText', () => {
  it.each([
    [0.2, 'under a minute'],
    [1, '1 minute'],
    [22, '22 minutes'],
    [60, '1 hour'],
    [125, '2 hours 5 minutes'],
  ])('says %s minutes as %s', (minutes, words) => {
    expect(minutesText(minutes)).toBe(words)
  })
})

describe('durationText', () => {
  it.each([
    [72, '72 ms'],
    [999.4, '999 ms'],
    [999.6, '1 s'],
    [1200, '1.2 s'],
    [5000, '5 s'],
    [6249, '6.2 s'],
    [-3, '0 ms'],
  ])('says %s ms as %s', (ms, words) => {
    expect(durationText(ms)).toBe(words)
  })
})

describe('localTime', () => {
  it('uses the zone it is given', () => {
    expect(localTime(t, { locale: 'en-GB', timeZone: 'Asia/Kolkata' })).toBe('2 Nov 2026, 19:20')
  })
})
