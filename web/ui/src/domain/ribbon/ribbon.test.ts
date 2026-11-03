import { describe, expect, it } from 'vitest'

import { at, event, report } from '../../test/fixtures'
import { reportStory } from '../story/report'

import { joined, ribbon } from './ribbon'

const resolved = report({
  stage: 'resolved',
  updates: [
    { stage: 'resolved', at: at(80), message: 'Fixed.' },
    { stage: 'monitoring', at: at(58), message: 'Watching.' },
    { stage: 'identified', at: at(51), message: 'Found it.' },
    { stage: 'investigating', at: at(44), message: 'Looking.' },
  ],
  resolvedAt: at(80),
  updatedAt: at(80),
})

const media = {
  key: 'media',
  name: 'Media',
  events: [event('START', -500), event('UNHEALTHY', 40), event('HEALTHY', 62)],
}

describe('ribbon', () => {
  it('lays the spec example on a 13:30 to 14:30 axis in 15-minute steps', () => {
    const picture = ribbon(resolved, reportStory(resolved, [media], at(90)), at(90))
    expect([picture.from, picture.to]).toEqual([at(30), at(90)])
    expect(picture.axis.map((tick) => tick.label)).toEqual([
      '13:30',
      '13:45',
      '14:00',
      '14:15',
      '14:30',
    ])
    expect(picture.axis.map((tick) => tick.at)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(picture.failed).toEqual([{ start: 10 / 60, end: 32 / 60, open: false }])
    expect(picture.report).toEqual({ start: 14 / 60, end: 50 / 60, open: false })
    expect(picture.stages.map((stage) => [stage.number, stage.label])).toEqual([
      [1, 'Investigating 13:44 UTC'],
      [2, 'Identified 13:51 UTC'],
      [3, 'Monitoring 13:58 UTC'],
      [4, 'Resolved 14:20 UTC'],
    ])
  })

  it('runs an open report to now and marks it open', () => {
    const open = report()
    const picture = ribbon(open, reportStory(open, [], at(50)), at(50))
    expect(picture.failed).toEqual([])
    expect(picture.report.open).toBe(true)
    expect(picture.report.end).toBeCloseTo((at(50) - picture.from) / (picture.to - picture.from))
    expect(picture.to).toBeGreaterThanOrEqual(at(50))
  })

  it('keeps every position on the axis', () => {
    const open = report()
    const failing = { ...media, events: [event('START', -500), event('UNHEALTHY', 40)] }
    const picture = ribbon(open, reportStory(open, [failing], at(70)), at(70))
    const all = [
      ...picture.failed.flatMap((span) => [span.start, span.end]),
      picture.report.start,
      picture.report.end,
      ...picture.stages.map((stage) => stage.at),
      ...picture.axis.map((tick) => tick.at),
    ]
    expect(all.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(picture.failed).toEqual([expect.objectContaining({ open: true })])
  })

  it('labels the axis with days when the report spans many days', () => {
    const long = report({ resolvedAt: at(44 + 6 * 24 * 60), stage: 'resolved', updates: [] })
    const picture = ribbon(long, reportStory(long, [], at(0)), at(0))
    expect(picture.axis.every((tick) => /^\d{1,2} Nov$/.test(tick.label))).toBe(true)
    expect(picture.axis.length).toBeLessThanOrEqual(5)
  })
})

describe('joined', () => {
  it('joins overlapping periods and keeps separate ones apart', () => {
    expect(
      joined([
        { start: 5, end: 9, open: false },
        { start: 0, end: 6, open: false },
        { start: 20, end: 30, open: true },
      ]),
    ).toEqual([
      { start: 0, end: 9, open: false },
      { start: 20, end: 30, open: true },
    ])
  })

  it('keeps a period open when an open one reaches its end', () => {
    expect(
      joined([
        { start: 0, end: 30, open: false },
        { start: 10, end: 30, open: true },
      ]),
    ).toEqual([{ start: 0, end: 30, open: true }])
  })
})
