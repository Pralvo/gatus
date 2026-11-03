import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow, Report } from '../../api/plugins/types'
import { at, report, results } from '../../test/fixtures'
import { newestCheckAt } from '../freshness/staleness'
import { momentAt, serviceStatuses, type ServiceInput } from '../status/service'

import { documentTitle, headline, type HeadlineInput } from './headline'

function service(key: string, name: string, overrides: Partial<ServiceInput> = {}): ServiceInput {
  return {
    key,
    name,
    group: 'Public site',
    results: results(10, { last: 60 }),
    usualMs: 70,
    ...overrides,
  }
}

const failing3 = results(10, { last: 60, failing: [50, 55, 60] })
const website = service('website', 'Website')
const blog = service('blog', 'Blog')
const media = service('media', 'Media')

interface Scene {
  inputs: ServiceInput[]
  reports?: Report[]
  windows?: MaintenanceWindow[]
  now?: number
  tense?: HeadlineInput['tense']
}

function headlineOf(scene: Scene) {
  const moment = momentAt(scene.now ?? at(61), scene.reports ?? [], scene.windows ?? [])
  return headline({
    loaded: true,
    services: serviceStatuses(scene.inputs, moment),
    moment,
    newestCheckAt: newestCheckAt(scene.inputs),
    tense: scene.tense ?? 'present',
    hasProbe: (key) => key === 'website' || key === 'media',
  })
}

function reportOn(
  impact: 'major' | 'partial' | 'degraded' | 'maintenance',
  key = 'blog',
  name = 'Blog',
) {
  return report({
    title: 'The blog is slow to load',
    endpoints: [{ key, name, impact }],
    updates: [{ stage: 'identified', at: at(51), message: 'Found it.' }],
  })
}

describe('unranked and rank 1', () => {
  it('says the status is unavailable when nothing loaded', () => {
    const moment = momentAt(at(61), [], [])
    expect(headline({ loaded: false, services: [], moment, newestCheckAt: null })).toMatchObject({
      rank: 1,
      tone: 'danger',
      title: 'Status unavailable',
      detail: 'This page could not load the service status. Try again in a minute.',
    })
  })

  it('says when nothing is configured', () => {
    expect(headlineOf({ inputs: [] })).toMatchObject({
      kind: 'nothing-configured',
      title: 'No services are monitored on this page',
      detail: null,
    })
  })

  it('says when no check has run yet', () => {
    expect(headlineOf({ inputs: [service('blog', 'Blog', { results: [] })] })).toMatchObject({
      kind: 'no-checks',
      title: 'No checks have run yet',
    })
  })
})

describe('rank 2, a reported outage', () => {
  it('names the service, quotes the report, and adds the failure', () => {
    const failingBlog = service('blog', 'Blog', { results: failing3 })
    expect(
      headlineOf({ inputs: [website, failingBlog], reports: [reportOn('major')] }),
    ).toMatchObject({
      rank: 2,
      title: 'Blog is down',
      detail:
        'Reported at 13:51 UTC: “The blog is slow to load”. Its last 3 checks failed, since 13:50 UTC.',
      keys: ['blog'],
    })
  })

  it('names a service this page does not monitor by the report’s name', () => {
    expect(
      headlineOf({ inputs: [website], reports: [reportOn('major', 'search', 'Search')] }),
    ).toMatchObject({ rank: 2, title: 'Search is down' })
  })
})

describe('rank 3, failed checks', () => {
  it('words one failing service, with a probe', () => {
    expect(
      headlineOf({ inputs: [website, service('media', 'Media', { results: failing3 })] }),
    ).toMatchObject({
      rank: 3,
      tone: 'danger',
      title: 'Media failed its latest check',
      detail:
        'It has failed its last 3 checks, since 13:50 UTC: answered with error 503; it needs a code below 500. Try it from your browser.',
    })
  })

  it('words a run of one', () => {
    const once = service('blog', 'Blog', { results: results(10, { last: 60, failing: [60] }) })
    expect(headlineOf({ inputs: [website, once] }).detail).toBe(
      'Its latest check, at 14:00 UTC, failed: answered with error 503; it needs a code below 500.',
    )
  })

  it('words two failing services, from the later start', () => {
    const a = service('website', 'Website', {
      results: results(10, { last: 60, failing: [45, 50, 55, 60] }),
    })
    const b = service('blog', 'Blog', { results: failing3 })
    expect(headlineOf({ inputs: [a, b, media] })).toMatchObject({
      title: 'Website and Blog failed their latest check',
      detail:
        'Website and Blog have failed their last 3 checks, since 13:50 UTC: answered with error 503; it needs a code below 500. Try it from your browser.',
    })
  })

  it('counts three or more', () => {
    const inputs = ['a', 'b', 'c'].map((key) =>
      service(key, key.toUpperCase(), { results: failing3 }),
    )
    expect(headlineOf({ inputs: [...inputs, media] }).title).toBe(
      '3 services failed their latest check',
    )
  })

  it('says every check failed when all did', () => {
    const inputs = [
      service('website', 'Website', { results: failing3 }),
      service('blog', 'Blog', { results: failing3 }),
    ]
    expect(headlineOf({ inputs })).toMatchObject({
      title: 'All services failed their latest check',
      detail:
        'Every check failed on its latest run, since 13:50 UTC. This can also mean our monitor cannot reach the internet.',
    })
  })

  it('shows a failure during maintenance', () => {
    const windows: MaintenanceWindow[] = [
      { title: 'Upgrade', start: at(30), end: at(120), state: 'in-progress', endpoints: [] },
    ]
    expect(
      headlineOf({ inputs: [website, service('blog', 'Blog', { results: failing3 })], windows })
        .rank,
    ).toBe(3)
  })
})

describe('ranks 4 to 6, reports', () => {
  it('words a partial outage', () => {
    expect(headlineOf({ inputs: [website, blog], reports: [reportOn('partial')] })).toMatchObject({
      rank: 4,
      tone: 'attention',
      title: 'Blog is partly down',
    })
  })

  it('words a degraded service as slower when measured slow', () => {
    const slowBlog = service('blog', 'Blog', { results: results(10, { last: 60, ms: 1200 }) })
    expect(
      headlineOf({ inputs: [website, slowBlog], reports: [reportOn('degraded')] }),
    ).toMatchObject({
      rank: 5,
      title: 'Blog is slower than usual',
      detail:
        'Reported at 13:51 UTC: “The blog is slow to load”. Measured: 1.2 s now, 70 ms usually.',
    })
  })

  it('words a degraded service as degraded otherwise', () => {
    expect(headlineOf({ inputs: [website, blog], reports: [reportOn('degraded')] })).toMatchObject({
      rank: 5,
      title: 'Blog is degraded',
      detail: 'Reported at 13:51 UTC: “The blog is slow to load”.',
    })
  })

  it('words a report naming no services', () => {
    expect(headlineOf({ inputs: [website], reports: [report({ endpoints: [] })] })).toMatchObject({
      rank: 6,
      title: 'We are looking into a problem',
      detail: 'Reported at 13:44 UTC: “Images were slow to load”.',
    })
  })
})

describe('ranks 7 to 10', () => {
  it('words a measured slowdown with no report', () => {
    const slowMedia = service('media', 'Media', {
      results: results(10, { last: 60, ms: 640 }),
      usualMs: 160,
    })
    expect(headlineOf({ inputs: [website, slowMedia] })).toMatchObject({
      rank: 7,
      title: 'Media is slower than usual',
      detail: 'Measured: 640 ms now, 160 ms usually. Its checks still pass.',
    })
  })

  it('words maintenance in progress, neutral', () => {
    const windows: MaintenanceWindow[] = [
      {
        title: 'Database upgrade',
        start: at(30),
        end: at(120),
        state: 'in-progress',
        endpoints: [{ key: 'database', name: 'DB' }],
      },
    ]
    expect(
      headlineOf({ inputs: [website, service('database', 'Database')], windows }),
    ).toMatchObject({
      rank: 8,
      tone: 'neutral',
      title: 'Maintenance in progress',
      detail:
        'Database: “Database upgrade”, until 15:00 UTC. Checks keep running, so a failure still shows.',
    })
  })

  it('counts a report with maintenance impact as maintenance', () => {
    expect(
      headlineOf({ inputs: [website, blog], reports: [reportOn('maintenance')] }),
    ).toMatchObject({
      rank: 8,
      detail: 'Blog: “The blog is slow to load”. Checks keep running, so a failure still shows.',
    })
  })

  it('says the page may be out of date when the newest check is old', () => {
    expect(headlineOf({ inputs: [website, blog], now: at(84) })).toMatchObject({
      rank: 9,
      title: 'Status may be out of date',
      detail:
        'Our newest check finished 24 minutes ago, at 14:00 UTC. Until then, every check passed.',
    })
  })

  it('puts "As of" before a stale failure, lowering only its own words', () => {
    const failingMedia = service('media', 'Media', { results: failing3 })
    expect(headlineOf({ inputs: [website, failingMedia], now: at(84) }).detail).toMatch(
      /^As of 14:00 UTC \(our newest check\), it has failed its last 3 checks/,
    )
    const a = service('website', 'Website', { results: failing3 })
    expect(headlineOf({ inputs: [a, failingMedia, blog], now: at(84) }).detail).toMatch(
      /^As of 14:00 UTC \(our newest check\), Website and Media have failed/,
    )
  })

  it('says everything is working', () => {
    expect(headlineOf({ inputs: [website, blog, media] })).toMatchObject({
      rank: 10,
      tone: 'success',
      title: 'Everything is working',
      detail: 'All 3 checks passed on their latest run, at their usual speed.',
    })
  })

  it('does not claim the usual speed without a comparison, and names services with no checks', () => {
    const unknown = service('blog', 'Blog', { usualMs: null })
    const fresh = service('db', 'Database', { results: [] })
    expect(headlineOf({ inputs: [website, unknown, fresh] }).detail).toBe(
      'All 2 checks passed on their latest run. Database has no checks yet.',
    )
  })
})

describe('time travel', () => {
  it('uses the past tense and no probe', () => {
    const failingMedia = service('media', 'Media', { results: failing3 })
    expect(headlineOf({ inputs: [website, failingMedia], tense: 'past' })).toMatchObject({
      title: 'Media had failed its latest check',
      detail:
        'Its checks had failed since 13:50 UTC: answered with error 503; it needs a code below 500.',
    })
    expect(
      headlineOf({ inputs: [website, blog], reports: [reportOn('partial')], tense: 'past' }).title,
    ).toBe('Blog was partly down')
    expect(headlineOf({ inputs: [website, blog], tense: 'past' })).toMatchObject({
      title: 'Everything was working',
      detail: 'All 2 checks had passed on their latest run.',
    })
  })

  it('never says "out of date" about the past', () => {
    expect(headlineOf({ inputs: [website], now: at(200), tense: 'past' }).rank).toBe(10)
  })
})

describe('documentTitle', () => {
  it('follows the H1, or names the moment in time travel', () => {
    const found = headlineOf({ inputs: [website] })
    expect(documentTitle(found, 'Pralvo status')).toBe('Everything is working · Pralvo status')
    expect(documentTitle(found, 'Pralvo status', at(50))).toBe('2 Nov 13:50 UTC · Pralvo status')
  })
})
