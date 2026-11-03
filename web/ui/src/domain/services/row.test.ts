import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow } from '../../api/plugins/types'
import { at, event, results } from '../../test/fixtures'
import { momentAt, serviceStatuses, type ServiceInput } from '../status/service'
import { statusAt } from '../travel/travel'

import { groupSentence, notKeptLine, rowLine } from './row'

const now = at(61)

function media(overrides: Partial<ServiceInput> = {}): ServiceInput {
  return {
    key: 'media',
    name: 'Media',
    group: 'Supporting services',
    results: results(10, { last: 60 }),
    usualMs: 70,
    ...overrides,
  }
}

function status(input: ServiceInput, windows: MaintenanceWindow[] = [], when = now) {
  const [found] = serviceStatuses([input], momentAt(when, [], windows))
  if (found === undefined) {
    throw new Error('no status')
  }
  return found
}

const options = { reference: now, stale: false }

describe('groupSentence', () => {
  it('counts working services', () => {
    expect(groupSentence([status(media())])).toBe('1 service, working')
    expect(groupSentence([status(media()), status(media({ key: 'blog', name: 'Blog' }))])).toBe(
      '2 services, all working',
    )
  })

  it('names the services that are not working', () => {
    const failed = status(media({ results: results(10, { last: 60, failing: [60] }) }))
    const slow = status(media({ key: 'blog', name: 'Blog', usualMs: 20 }))
    expect(groupSentence([failed, slow, status(media({ key: 'web', name: 'Web' }))])).toBe(
      'Media: check failed; Blog: slower than usual',
    )
  })
})

describe('rowLine', () => {
  it('compares with normal when passing', () => {
    expect(rowLine(status(media()), options)).toBe('As fast as usual: 70 ms now, 70 ms usually.')
  })

  it('gives the trend and why when failing', () => {
    const failed = status(media({ results: results(10, { last: 60, failing: [50, 55, 60] }) }))
    expect(rowLine(failed, options)).toBe(
      'Failed its last 3 checks, since 13:50 UTC: answered with error 503; it needs a code below 500.',
    )
  })

  it('puts a recovering trend before the comparison', () => {
    const recovering = status(media({ results: results(10, { last: 60, failing: [50] }) }))
    expect(rowLine(recovering, options)).toBe(
      'Recovering: the last 2 checks passed after 1 failure. As fast as usual: 70 ms now, 70 ms usually.',
    )
  })

  it('gives the last check time when the page is stale or the check is late', () => {
    const line = 'Last check 21 minutes ago, at 14:00 UTC.'
    expect(rowLine(status(media(), [], at(81)), { reference: at(81), stale: true })).toBe(line)
    expect(rowLine(status(media(), [], at(81)), { reference: at(81), stale: false })).toBe(line)
  })

  it('names the maintenance', () => {
    const window: MaintenanceWindow = {
      title: 'Media upgrade',
      start: at(30),
      end: at(120),
      state: 'in-progress',
      endpoints: [],
    }
    expect(rowLine(status(media(), [window]), options)).toBe(
      '“Media upgrade”. Checks keep running, so a failure still shows.',
    )
  })

  it('says when a service has no checks yet', () => {
    expect(rowLine(status(media({ results: [] })), options)).toBe(
      'The first check has not finished yet.',
    )
  })

  it('says when check details for a past moment are gone', () => {
    const view = statusAt({
      at: at(-600),
      services: [media({ events: [event('START', -700), event('UNHEALTHY', -620)] })],
      reports: [],
      windows: [],
    })
    const [past] = view.services
    expect(past && rowLine(past, { reference: at(-600), stale: false, kept: false })).toBe(
      `Failing since 02:40 UTC. ${notKeptLine}`,
    )
    const healthy = statusAt({
      at: at(-600),
      services: [media({ events: [event('START', -700)] })],
      reports: [],
      windows: [],
    }).services[0]
    expect(healthy && rowLine(healthy, { reference: at(-600), stale: false, kept: false })).toBe(
      notKeptLine,
    )
  })
})
