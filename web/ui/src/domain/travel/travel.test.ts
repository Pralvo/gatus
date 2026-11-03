import { describe, expect, it } from 'vitest'

import { at, event, report, result, results } from '../../test/fixtures'
import { headline } from '../headline/headline'
import type { ServiceInput } from '../status/service'

import { checksNotKeptMessage, keptFrom, statusAt, travelBanner } from './travel'

const now = at(24 * 60)
const media: ServiceInput = {
  key: 'media',
  name: 'Media',
  group: 'Supporting services',
  results: results(10, { last: 60, failing: [40, 45, 50, 55, 60] }),
  events: [event('START', -1000), event('UNHEALTHY', 40), event('HEALTHY', 62)],
  usualMs: 70,
}
const website: ServiceInput = {
  key: 'website',
  name: 'Website',
  group: 'Public site',
  results: results(10, { last: 60 }),
  events: [event('START', -1000)],
  usualMs: 70,
}
const travelReport = report({
  stage: 'resolved',
  updates: [
    { stage: 'resolved', at: at(80), message: 'Fixed.' },
    { stage: 'investigating', at: at(44), message: 'Looking.' },
  ],
  resolvedAt: at(80),
  updatedAt: at(80),
})

describe('statusAt', () => {
  it('rebuilds a failure from events and kept results', () => {
    const view = statusAt({
      at: at(50),
      services: [website, media],
      reports: [travelReport],
      windows: [],
    })
    const failing = view.services.find((service) => service.key === 'media')
    expect(failing).toMatchObject({
      state: 'failed',
      failing: true,
      failingSince: at(40),
      failRun: 3,
      latestAt: at(50),
    })
    expect(failing?.why[0]?.text).toBe('answered with error 503; it needs a code below 500')
    expect(
      view.results
        .get('media')
        ?.map((item) => item.timestamp)
        .at(-1),
    ).toBe(new Date(at(50)).toISOString())
    expect(view.moment.reports.map((item) => item.stage)).toEqual(['investigating'])
    expect(view).toMatchObject({ checksKept: true, messages: [] })
  })

  it('feeds the headline in the past tense', () => {
    const view = statusAt({ at: at(50), services: [website, media], reports: [], windows: [] })
    expect(
      headline({
        loaded: true,
        services: view.services,
        moment: view.moment,
        newestCheckAt: null,
        tense: 'past',
      }),
    ).toMatchObject({
      title: 'Media had failed its latest check',
      detail:
        'Its checks had failed since 13:40 UTC: answered with error 503; it needs a code below 500.',
    })
  })

  it('uses events alone when check details are no longer kept', () => {
    const older = {
      ...media,
      events: [event('START', -1000), event('UNHEALTHY', -300), event('HEALTHY', -200)],
    }
    const view = statusAt({ at: at(-250), services: [website, older], reports: [], windows: [] })
    expect(view.services.find((service) => service.key === 'media')).toMatchObject({
      state: 'failed',
      failingSince: at(-300),
      failRun: null,
      why: [],
    })
    expect(view.checksKept).toBe(false)
    expect(view.messages).toEqual([checksNotKeptMessage])
  })

  it('shows a service with no record yet as having no checks', () => {
    const view = statusAt({ at: at(-2000), services: [website], reports: [], windows: [] })
    expect(view.services[0]).toMatchObject({ state: 'no-checks', hasChecks: false })
  })

  it('falls back to kept results while events are not loaded', () => {
    const { events: _events, ...noEvents } = media
    const view = statusAt({ at: at(50), services: [noEvents], reports: [], windows: [] })
    expect(view.services[0]).toMatchObject({ failing: true, failingSince: at(40) })
  })

  it('counts maintenance whose window contains T, and never calls a check late', () => {
    const window = {
      title: 'Work',
      start: at(0),
      end: at(30),
      state: 'finished' as const,
      endpoints: [],
    }
    const view = statusAt({ at: at(20), services: [website], reports: [], windows: [window] })
    expect(view.services[0]).toMatchObject({
      state: 'maintenance',
      word: 'Maintenance until 13:30 UTC',
      late: false,
    })
  })

  it('ignores results after T', () => {
    const later = {
      ...website,
      results: [result({ minute: 10 }), result({ minute: 70, ok: false })],
    }
    const view = statusAt({ at: at(20), services: [later], reports: [], windows: [] })
    expect(view.results.get('website')).toHaveLength(1)
  })
})

describe('banner', () => {
  it('words the banner with how long check details are kept', () => {
    expect(travelBanner(at(50), now - 8 * 3_600_000, now)).toBe(
      'You are looking at 2 Nov 2026, 13:50 UTC. This view is rebuilt from the record: checks, reports and maintenance. Check details older than about 8 hours and hourly speeds older than 2 days are not kept. Report titles show their current wording.',
    )
    expect(travelBanner(at(50), null, now)).toContain(
      'Hourly speeds older than 2 days are not kept.',
    )
  })

  it('finds when every service still has check details', () => {
    expect(
      keptFrom([{ results: results(3, { last: 60 }) }, { results: results(3, { last: 40 }) }]),
    ).toBe(at(50))
    expect(keptFrom([{ results: [] }])).toBeNull()
  })
})
