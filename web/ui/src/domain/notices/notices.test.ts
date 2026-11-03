import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow } from '../../api/plugins/types'
import { at, report } from '../../test/fixtures'

import { covers, windowFor, windowsAt, windowsDuring } from './maintenance'
import { impactOn, reportsAt, stageWord } from './reports'

const updated = report({
  stage: 'resolved',
  endpoints: [
    { key: 'media', name: 'Media', impact: 'degraded' },
    { key: 'blog', name: 'Blog', impact: 'major' },
  ],
  updates: [
    { stage: 'resolved', at: at(80), message: 'Fixed.' },
    { stage: 'identified', at: at(51), message: 'Found it.' },
    { stage: 'investigating', at: at(44), message: 'Looking.' },
  ],
  resolvedAt: at(80),
  updatedAt: at(80),
})

describe('reportsAt', () => {
  it('takes the stage and text from the latest update at or before the moment', () => {
    const [open] = reportsAt([updated], at(50))
    expect(open).toMatchObject({
      stage: 'investigating',
      latestAt: at(44),
      latestMessage: 'Looking.',
    })
    expect(open?.updates.map((update) => update.stage)).toEqual(['investigating'])
    expect(reportsAt([updated], at(51))[0]?.stage).toBe('identified')
  })

  it('leaves out reports not yet published or already resolved', () => {
    expect(reportsAt([updated], at(43))).toEqual([])
    expect(reportsAt([updated], at(80))).toEqual([])
    expect(reportsAt([updated], at(500))).toEqual([])
  })

  it('leaves out a report resolved by the moment even when its updates do not say so', () => {
    const resolvedListItem = report({ resolvedAt: at(80), updatedAt: at(80) })
    expect(reportsAt([resolvedListItem], at(79))).toHaveLength(1)
    expect(reportsAt([resolvedListItem], at(80))).toEqual([])
  })

  it('says the stage is unknown when only a later update is loaded', () => {
    const listItem = report({
      stage: 'monitoring',
      updates: [{ stage: 'monitoring', at: at(70), message: 'Watching.' }],
      updatedAt: at(70),
    })
    expect(reportsAt([listItem], at(50))[0]).toMatchObject({ stage: null, latestAt: at(44) })
    expect(reportsAt([listItem], at(75))[0]?.stage).toBe('monitoring')
  })

  it('uses the report stage when it has no updates at all', () => {
    expect(reportsAt([report({ updates: [] })], at(60))[0]?.stage).toBe('investigating')
  })

  it('orders open reports by their latest word, newest first', () => {
    const older = report({ id: 'old', publishedAt: at(10), updates: [], updatedAt: at(10) })
    expect(reportsAt([older, report()], at(60)).map((item) => item.id)).toEqual(['r1', 'old'])
  })
})

describe('impactOn', () => {
  const open = reportsAt(
    [
      report({ id: 'a', endpoints: [{ key: 'media', name: 'Media', impact: 'degraded' }] }),
      report({ id: 'b', endpoints: [{ key: 'media', name: 'Media', impact: 'partial' }] }),
    ],
    at(60),
  )

  it('takes the worst impact and its report', () => {
    expect(impactOn(open, 'media')).toMatchObject({ impact: 'partial', report: { id: 'b' } })
  })

  it('gives null for a service no report names', () => {
    expect(impactOn(open, 'database')).toBeNull()
  })

  it('words the stages', () => {
    expect(stageWord('investigating')).toBe('Investigating')
  })
})

describe('maintenance', () => {
  const upgrade: MaintenanceWindow = {
    title: 'Database upgrade',
    start: at(30),
    end: at(120),
    state: 'in-progress',
    endpoints: [{ key: 'database', name: 'Database' }],
  }
  const everything: MaintenanceWindow = { ...upgrade, title: 'All', end: at(90), endpoints: [] }

  it('finds windows by time, start included and end excluded', () => {
    expect(windowsAt([upgrade], at(30))).toHaveLength(1)
    expect(windowsAt([upgrade], at(120))).toHaveLength(0)
    expect(windowsAt([upgrade], at(29))).toHaveLength(0)
  })

  it('treats a window naming no services as covering all of them', () => {
    expect(covers(everything, 'media')).toBe(true)
    expect(covers(upgrade, 'media')).toBe(false)
  })

  it('picks the covering window that ends last', () => {
    expect(windowFor([everything, upgrade], 'database')?.title).toBe('Database upgrade')
    expect(windowFor([upgrade], 'media')).toBeNull()
  })

  it('finds windows that overlap a period', () => {
    expect(windowsDuring([upgrade], at(0), at(30))).toHaveLength(0)
    expect(windowsDuring([upgrade], at(0), at(31))).toHaveLength(1)
  })
})
