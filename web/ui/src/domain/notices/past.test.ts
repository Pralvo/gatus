import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow } from '../../api/plugins/types'
import { at, base, report } from '../../test/fixtures'
import { dayMs } from '../time/format'

import { noticeLabel, pastNotices } from './past'

const day = (offset: number) => base - (base % dayMs) + offset * dayMs

function window(overrides: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
  return {
    title: 'Database upgrade',
    start: at(30),
    end: at(120),
    state: 'in-progress',
    endpoints: [{ key: 'database', name: 'Database' }],
    ...overrides,
  }
}

describe('pastNotices', () => {
  it('lists 14 days, newest first, keeping empty days', () => {
    const days = pastNotices({ reports: [], windows: [], end: at(60) })
    expect(days).toHaveLength(14)
    expect(days[0]?.start).toBe(day(0))
    expect(days[13]?.start).toBe(day(-13))
    expect(days.every((entry) => entry.items.length === 0)).toBe(true)
  })

  it('puts a resolved report on the day it was resolved, as resolved', () => {
    const resolved = report({
      stage: 'resolved',
      resolvedAt: at(80),
      updatedAt: at(80),
      updates: [
        { stage: 'resolved', at: at(80), message: 'Fixed.' },
        { stage: 'investigating', at: at(44), message: 'Looking.' },
      ],
    })
    const [today] = pastNotices({ reports: [resolved], windows: [], end: at(90) })
    expect(today?.items).toEqual([
      {
        kind: 'report',
        id: 'r1',
        title: 'Images were slow to load',
        stage: 'resolved',
        at: at(80),
      },
    ])
    expect(today?.items[0] && noticeLabel(today.items[0])).toBe('Resolved')
  })

  it('shows a report with the stage it had at a past moment', () => {
    const resolved = report({
      stage: 'resolved',
      resolvedAt: at(80),
      updatedAt: at(80),
      updates: [
        { stage: 'resolved', at: at(80), message: 'Fixed.' },
        { stage: 'investigating', at: at(44), message: 'Looking.' },
      ],
    })
    const [today] = pastNotices({ reports: [resolved], windows: [], end: at(50) })
    expect(today?.items).toMatchObject([{ stage: 'investigating', at: at(44) }])
  })

  it('leaves out reports published after the end and notices older than the days shown', () => {
    const later = report({ id: 'later', publishedAt: at(100), updates: [], updatedAt: at(100) })
    const old = report({
      id: 'old',
      publishedAt: day(-20),
      updatedAt: day(-20),
      updates: [],
    })
    const days = pastNotices({ reports: [later, old], windows: [], end: at(60) })
    expect(days.flatMap((entry) => entry.items)).toEqual([])
    const wider = pastNotices({ reports: [old], windows: [], end: at(60), days: 28 })
    expect(wider.flatMap((entry) => entry.items)).toHaveLength(1)
  })

  it('says "Published" when no update by then gives a stage', () => {
    const unknown = report({ updates: [], updatedAt: at(100) })
    const items = pastNotices({ reports: [unknown], windows: [], end: at(60) })[0]?.items ?? []
    expect(items).toMatchObject([{ stage: null, at: at(44) }])
    expect(items[0] && noticeLabel(items[0])).toBe('Published')
  })

  it('lists maintenance in progress on its start and finished on its end, never upcoming', () => {
    const items =
      pastNotices({
        reports: [],
        windows: [
          window(),
          window({ title: 'Earlier', start: at(-60), end: at(-30) }),
          window({ title: 'Upcoming', start: at(200), end: at(260) }),
        ],
        end: at(60),
      })[0]?.items ?? []
    expect(items.map((item) => [item.title, noticeLabel(item), item.at])).toEqual([
      ['Database upgrade', 'Maintenance in progress', at(30)],
      ['Earlier', 'Maintenance finished', at(-30)],
    ])
  })
})
