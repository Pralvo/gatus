import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow } from '../../api/plugins/types'
import { at, event, report } from '../../test/fixtures'

import { failureIntervals, overlapMs, recordStart, stateAt } from './intervals'
import {
  accuracyCaption,
  buildRecord,
  dayDetail,
  noRecordCaption,
  recordCaption,
  type RecordInput,
} from './record'

const day = 24 * 60
const mediaEvents = [
  event('START', -21 * day),
  event('HEALTHY', -21 * day + 1),
  event('UNHEALTHY', 40),
  event('HEALTHY', 62),
]

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    services: [
      { key: 'media', name: 'Media', events: mediaEvents },
      { key: 'blog', name: 'Blog', events: [event('START', -10 * day)] },
    ],
    reports: [],
    windows: [],
    end: at(65),
    ...overrides,
  }
}

function today(record: ReturnType<typeof buildRecord>) {
  const last = record.days.at(-1)
  if (last === undefined) {
    throw new Error('no days')
  }
  return last
}

describe('intervals', () => {
  it('runs from UNHEALTHY to the next HEALTHY or START', () => {
    const events = [
      event('UNHEALTHY', 0),
      event('START', 10),
      event('UNHEALTHY', 20),
      event('HEALTHY', 25),
    ]
    expect(failureIntervals(events, at(100))).toEqual([
      { start: at(0), end: at(10), open: false },
      { start: at(20), end: at(25), open: false },
    ])
  })

  it('keeps a failure open at the end and ignores later events', () => {
    expect(failureIntervals(mediaEvents, at(50))).toEqual([
      { start: at(40), end: at(50), open: true },
    ])
  })

  it('handles missing and unreadable events', () => {
    expect(failureIntervals(undefined, at(50))).toEqual([])
    expect(failureIntervals([{ type: 'UNHEALTHY', timestamp: 'bad' }], at(50))).toEqual([])
  })

  it('measures overlap and finds the state at a moment', () => {
    expect(overlapMs({ start: at(0), end: at(10) }, at(5), at(20))).toBe(5 * 60_000)
    expect(overlapMs({ start: at(0), end: at(10) }, at(10), at(20))).toBe(0)
    expect(stateAt(mediaEvents, at(50))?.type).toBe('UNHEALTHY')
    expect(stateAt(mediaEvents, at(-30 * day))).toBeNull()
  })

  it('finds when monitoring began', () => {
    expect(recordStart([mediaEvents, undefined])).toBe(at(-21 * day))
    expect(recordStart([[event('HEALTHY', 5)]])).toBe(at(5))
    expect(recordStart([undefined])).toBeNull()
  })
})

describe('buildRecord', () => {
  it('gives 91 days ending today, with no record before monitoring began', () => {
    const record = buildRecord(input())
    expect(record.days).toHaveLength(91)
    expect(record.last).toBe(Date.UTC(2026, 10, 2))
    expect(record.days[0]?.kind).toBe('no-record')
    expect(record.days.at(-22)?.kind).toBe('ok')
    expect(record.days.at(-23)?.kind).toBe('no-record')
    expect(record.complete).toBe(true)
    expect(recordCaption(record)).toBe(
      '4 Aug to 2 Nov. Each column is 7 days; the newest day is at the bottom right.',
    )
    expect(noRecordCaption(record.recordStart)).toBe(
      'No record (before 12 Oct, when monitoring began)',
    )
  })

  it('marks under 30 minutes of failure as minor and 30 or more as major', () => {
    expect(today(buildRecord(input()))).toMatchObject({ kind: 'minor', failedMinutes: 22 })
    const long = input({
      services: [
        {
          key: 'media',
          name: 'Media',
          events: [event('START', -day), event('UNHEALTHY', 10), event('HEALTHY', 40)],
        },
      ],
    })
    expect(today(buildRecord(long))).toMatchObject({ kind: 'major', failedMinutes: 30 })
  })

  it('writes the day detail, with the report on the failure', () => {
    const record = buildRecord(input({ reports: [report()] }))
    expect(dayDetail(today(record))).toBe(
      '2 Nov: Media failed checks for 22 minutes (13:40 to 14:02 UTC). Report: “Images were slow to load”.',
    )
    expect(today(record).items[0]).toMatchObject({ kind: 'failed', seeAt: at(51) })
  })

  it('says a failure is still open', () => {
    const record = buildRecord(input({ end: at(50) }))
    expect(dayDetail(today(record))).toBe(
      '2 Nov: Media failed checks for 10 minutes (from 13:40 UTC, still failing).',
    )
  })

  it('splits a failure across midnight', () => {
    const events = [
      event('START', -2 * day),
      event('UNHEALTHY', -(13 * 60) - 20),
      event('HEALTHY', -(13 * 60) + 40),
    ]
    const record = buildRecord(input({ services: [{ key: 'media', name: 'Media', events }] }))
    expect(record.days.at(-2)?.failedMinutes).toBe(20)
    expect(dayDetail(today(record))).toBe(
      '2 Nov: Media failed checks for 40 minutes (00:00 to 00:40 UTC).',
    )
  })

  it('marks a day with only a report as minor and a quiet day as such', () => {
    const blogReport = report({
      id: 'b',
      title: 'Blog slow',
      endpoints: [{ key: 'blog', name: 'Blog', impact: 'degraded' }],
    })
    const quiet = input({
      services: [{ key: 'blog', name: 'Blog', events: [event('START', -day)] }],
      reports: [blogReport],
    })
    const record = buildRecord(quiet)
    expect(today(record).kind).toBe('minor')
    expect(dayDetail(today(record))).toBe('2 Nov: Blog: report “Blog slow” published at 13:44 UTC.')
    expect(dayDetail(record.days.at(-2) ?? today(record))).toBe('1 Nov: no failed checks.')
  })

  it('marks maintenance in neutral, and lets failures outrank it', () => {
    const window: MaintenanceWindow = {
      title: 'Upgrade',
      start: at(-300),
      end: at(-200),
      state: 'finished',
      endpoints: [],
    }
    const quiet = input({
      services: [{ key: 'blog', name: 'Blog', events: [event('START', -day)] }],
      windows: [window],
    })
    expect(today(buildRecord(quiet)).kind).toBe('maintenance')
    expect(dayDetail(today(buildRecord(quiet)))).toBe(
      '2 Nov: All services: maintenance “Upgrade”, 08:00 to 09:40 UTC.',
    )
    expect(today(buildRecord(input({ windows: [window] }))).kind).toBe('minor')
  })

  it('treats a report with only maintenance impact as maintenance', () => {
    const planned = report({ endpoints: [{ key: 'blog', name: 'Blog', impact: 'maintenance' }] })
    const quiet = input({
      services: [{ key: 'blog', name: 'Blog', events: [event('START', -day)] }],
      reports: [planned],
    })
    expect(today(buildRecord(quiet)).kind).toBe('maintenance')
  })

  it('filters to one service, its reports and its windows', () => {
    const blogOnly = buildRecord(input({ filter: 'blog', reports: [report()] }))
    expect(today(blogOnly)).toMatchObject({ kind: 'ok', items: [] })
    const window: MaintenanceWindow = {
      title: 'Media work',
      start: at(-300),
      end: at(-200),
      state: 'finished',
      endpoints: [{ key: 'media', name: 'Media' }],
    }
    expect(today(buildRecord(input({ filter: 'blog', windows: [window] }))).kind).toBe('ok')
  })

  it('is no record everywhere when no events are loaded, and says it is incomplete', () => {
    const record = buildRecord(input({ services: [{ key: 'media', name: 'Media' }] }))
    expect(record.days.every((item) => item.kind === 'no-record')).toBe(true)
    expect(record.complete).toBe(false)
    expect(dayDetail(today(record))).toBe('2 Nov: no record.')
  })

  it('ends on the time-travel day and ignores what came after', () => {
    const record = buildRecord(input({ end: at(-day) }))
    expect(record.last).toBe(Date.UTC(2026, 10, 1))
    expect(today(record).kind).toBe('ok')
  })

  it('keeps the accuracy caption', () => {
    expect(accuracyCaption).toMatch(/^Failed-check minutes are measured/)
  })
})
