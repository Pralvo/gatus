import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow, Report } from '../../api/plugins/types'
import type { Result } from '../../api/types'
import { at, event, report, result, results } from '../../test/fixtures'
import { momentAt, serviceStatuses, type ServiceStatus } from '../status/service'
import { statusAt } from '../travel/travel'

import { serviceDetail } from './detail'
import { failedShareText, normalFigures } from './figures'

function media(
  kept: Result[],
  options: { now?: number; usual?: number; reports?: Report[]; windows?: MaintenanceWindow[] } = {},
): ServiceStatus {
  const now = options.now ?? at(61)
  const [status] = serviceStatuses(
    [
      {
        key: 'media',
        name: 'Media',
        group: 'Supporting services',
        results: kept,
        usualMs: options.usual ?? 70,
      },
    ],
    momentAt(now, options.reports ?? [], options.windows ?? []),
  )
  if (status === undefined) {
    throw new Error('no status')
  }
  return status
}

describe('serviceDetail', () => {
  it('says when the latest check passed, and the trend', () => {
    expect(
      serviceDetail(media(results(6, { last: 60 })), { reference: at(61), stale: false }),
    ).toBe('The latest check passed at 14:00 UTC. Steady.')
  })

  it('gives the failing run and why', () => {
    const service = media(results(6, { last: 60, failing: [50, 55, 60] }))
    expect(serviceDetail(service, { reference: at(61), stale: false })).toBe(
      'Failed its last 3 checks, since 13:50 UTC. Why: answered with error 503; it needs a code below 500.',
    )
  })

  it('names the report first for a reported outage, then the checks', () => {
    const down = report({ endpoints: [{ key: 'media', name: 'Media', impact: 'major' }] })
    const service = media(results(6, { last: 60, failing: [55, 60] }), { reports: [down] })
    expect(service.state).toBe('down')
    expect(serviceDetail(service, { reference: at(61), stale: false })).toBe(
      'Reported at 13:44 UTC: “Images were slow to load”. Its last 2 checks failed, since 13:55 UTC. Why: answered with error 503; it needs a code below 500.',
    )
  })

  it('quotes a degraded report with the measured speed when slow', () => {
    const slow = results(6, { last: 60, ms: 700 })
    const service = media(slow, { reports: [report()] })
    expect(serviceDetail(service, { reference: at(61), stale: false })).toBe(
      'Reported at 13:44 UTC: “Images were slow to load”. Measured: 700 ms now, 70 ms usually.',
    )
  })

  it('says slower than usual from the checks alone', () => {
    const service = media(results(6, { last: 60, ms: 700 }))
    expect(service.state).toBe('slow')
    expect(serviceDetail(service, { reference: at(61), stale: false })).toBe(
      'Measured: 700 ms now, 70 ms usually. Its checks still pass.',
    )
  })

  it('names the maintenance window', () => {
    const window: MaintenanceWindow = {
      title: 'Storage move',
      start: at(30),
      end: at(120),
      state: 'in-progress',
      endpoints: [{ key: 'media', name: 'Media' }],
    }
    const service = media(results(6, { last: 60 }), { windows: [window] })
    expect(service.word).toBe('Maintenance until 15:00 UTC')
    expect(serviceDetail(service, { reference: at(61), stale: false })).toBe(
      '“Storage move”. Checks keep running, so a failure still shows.',
    )
  })

  it('says when there are no checks yet, and when the monitor is stale', () => {
    expect(serviceDetail(media([]), { reference: at(61), stale: false })).toBe(
      'The first check has not finished yet.',
    )
    const service = media(results(6, { last: 41 }), { now: at(65) })
    expect(serviceDetail(service, { reference: at(65), stale: true })).toBe(
      'Last check 24 minutes ago, at 13:41 UTC.',
    )
  })

  it('reads the past from the record when check details are gone', () => {
    const view = statusAt({
      at: at(-600),
      services: [
        {
          key: 'media',
          name: 'Media',
          group: '',
          results: results(3, { last: 60 }),
          events: [event('START', -2000), event('UNHEALTHY', -700), event('HEALTHY', -500)],
        },
      ],
      reports: [],
      windows: [],
    })
    const [service] = view.services
    expect(service).toBeDefined()
    if (service === undefined) {
      return
    }
    expect(
      serviceDetail(service, { reference: at(-600), stale: false, tense: 'past', kept: false }),
    ).toBe('Had been failing since 01:20 UTC. Check details for this time are no longer kept.')
  })

  it('keeps hostile server text as text', () => {
    const hostile: Result = result({
      minute: 60,
      ok: false,
      conditions: [{ condition: '[BODY] == <img src=x onerror=alert(1)>', success: false }],
    })
    const service = media([hostile])
    expect(serviceDetail(service, { reference: at(61), stale: false })).toBe(
      'Its latest check, at 14:00 UTC, failed. Why: [BODY] == <img src=x onerror=alert(1)>.',
    )
  })
})

describe('figures', () => {
  it('turns the 30-day uptime into a failed share', () => {
    expect(failedShareText(0.995)).toBe('0.5%')
    expect(failedShareText(1)).toBe('0%')
    expect(failedShareText(0.9999)).toBe('under 0.1%')
    expect(failedShareText(0)).toBe('100%')
    expect(failedShareText(null)).toBeNull()
    expect(failedShareText(Number.NaN)).toBeNull()
  })

  it('gives now, usual and failed, with the sentence', () => {
    const figures = normalFigures(media(results(6, { last: 60, ms: 72 })).normal, 0.995)
    expect(figures.speeds).toEqual([
      { label: 'Now (last 3 passing checks)', value: '72 ms' },
      { label: 'Usual (median, 7 days)', value: '70 ms' },
    ])
    expect(figures.failed).toEqual({ label: 'Failed checks (30 days)', value: '0.5%' })
    expect(figures.sentence).toBe('As fast as usual: 72 ms now, 70 ms usually.')
  })

  it('hides the speeds for a check that does not measure response time', () => {
    const figures = normalFigures(media(results(6, { last: 60, ms: 0 })).normal, null)
    expect(figures.speeds).toEqual([])
    expect(figures.failed.value).toBeNull()
    expect(figures.sentence).toBe('This check does not measure response time.')
  })
})
