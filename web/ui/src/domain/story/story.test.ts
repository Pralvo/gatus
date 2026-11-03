import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow } from '../../api/plugins/types'
import { at, report, results } from '../../test/fixtures'
import { momentAt, serviceStatuses, type ServiceInput } from '../status/service'

import { homeStory } from './story'

function service(key: string, name: string, overrides: Partial<ServiceInput> = {}): ServiceInput {
  return { key, name, group: 'g', results: results(10, { last: 60 }), usualMs: 70, ...overrides }
}

const upgrade: MaintenanceWindow = {
  title: 'Database upgrade',
  start: at(30),
  end: at(120),
  state: 'in-progress',
  endpoints: [{ key: 'database', name: 'Database' }],
}

function storyOf(
  inputs: ServiceInput[],
  options: { reports?: ReturnType<typeof report>[]; windows?: MaintenanceWindow[] } = {},
) {
  const moment = momentAt(at(61), options.reports ?? [], options.windows ?? [])
  return homeStory(serviceStatuses(inputs, moment), moment)
}

describe('homeStory', () => {
  it('is empty when everything is normal', () => {
    expect(storyOf([service('website', 'Website')])).toEqual([])
  })

  it('tells a failure, then the latest failed check with its reason', () => {
    const media = service('media', 'Media', {
      results: results(10, { last: 60, failing: [50, 55, 60] }),
    })
    expect(storyOf([media]).map(({ at: time, source, text }) => ({ time, source, text }))).toEqual([
      { time: at(50), source: 'Measured', text: 'Checks for Media began failing.' },
      {
        time: at(60),
        source: 'Measured',
        text: 'Media failed again (3 failed checks in a row): answered with error 503; it needs a code below 500.',
      },
    ])
  })

  it('tells a single failed check in one item', () => {
    const media = service('media', 'Media', { results: results(10, { last: 60, failing: [60] }) })
    expect(storyOf([media]).map((item) => item.text)).toEqual([
      'Checks for Media began failing: answered with error 503; it needs a code below 500.',
    ])
  })

  it('joins measured, reported and scheduled items in time order', () => {
    const slowBlog = service('blog', 'Blog', { results: results(10, { last: 60, ms: 1200 }) })
    const blogReport = report({
      endpoints: [{ key: 'blog', name: 'Blog', impact: 'degraded' }],
      updates: [
        { stage: 'identified', at: at(51), message: 'Found it.' },
        { stage: 'investigating', at: at(44), message: 'Looking.' },
      ],
    })
    const items = storyOf([slowBlog, service('database', 'Database')], {
      reports: [blogReport],
      windows: [upgrade],
    })
    expect(items.map((item) => [item.source, item.text])).toEqual([
      ['Scheduled', 'Maintenance began on Database: “Database upgrade”, until 15:00 UTC.'],
      ['Reported', 'Investigating: “Looking.”'],
      ['Reported', 'Identified: “Found it.”'],
      ['Measured', 'Blog answers are slower than usual: 1.2 s now, 70 ms usually.'],
    ])
  })

  it('says when a slowdown has no report', () => {
    const slowMedia = service('media', 'Media', {
      results: results(10, { last: 60, ms: 640 }),
      usualMs: 160,
    })
    expect(storyOf([slowMedia])[0]?.text).toBe(
      'Media answers are slower than usual: 640 ms now, 160 ms usually. No report has been published.',
    )
  })

  it('tells maintenance and a failure together', () => {
    const database = service('database', 'Database', {
      results: results(10, { last: 60, failing: [60] }),
    })
    expect(
      storyOf([database], { windows: [{ ...upgrade, endpoints: [] }] }).map((item) => item.source),
    ).toEqual(['Scheduled', 'Measured'])
    expect(storyOf([database], { windows: [{ ...upgrade, endpoints: [] }] })[0]?.text).toContain(
      'all services',
    )
  })

  it('tells a report on a service this page does not monitor', () => {
    const elsewhere = report({ endpoints: [{ key: 'search', name: 'Search', impact: 'major' }] })
    expect(storyOf([service('website', 'Website')], { reports: [elsewhere] })).toMatchObject([
      {
        source: 'Reported',
        tone: 'danger',
        reportId: 'r1',
        text: 'Investigating: “We are looking into it.”',
      },
    ])
  })

  it('never says how fast a report was published', () => {
    const media = service('media', 'Media', {
      results: results(10, { last: 60, failing: [40, 45, 50, 55, 60] }),
    })
    const items = storyOf([media], { reports: [report()] })
    expect(items.some((item) => item.text.includes('Published'))).toBe(false)
  })

  it('names a report without updates by its title', () => {
    expect(
      storyOf([service('website', 'Website')], { reports: [report({ updates: [] })] })[0]?.text,
    ).toBe('Published: “Images were slow to load”.')
  })
})
