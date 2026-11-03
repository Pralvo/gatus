import { describe, expect, it } from 'vitest'

import type { MaintenanceWindow } from '../../api/plugins/types'
import { at, event, report, results } from '../../test/fixtures'

import { momentAt, serviceInputs, serviceStatuses, type ServiceInput } from './service'

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

const upgrade: MaintenanceWindow = {
  title: 'Media upgrade',
  start: at(30),
  end: at(120),
  state: 'in-progress',
  endpoints: [{ key: 'media', name: 'Media' }],
}

function statusOf(
  input: ServiceInput,
  options: {
    reports?: ReturnType<typeof report>[]
    windows?: MaintenanceWindow[]
    when?: number
  } = {},
) {
  const moment = momentAt(options.when ?? now, options.reports ?? [], options.windows ?? [])
  const [status] = serviceStatuses([input], moment)
  if (status === undefined) {
    throw new Error('no status')
  }
  return status
}

describe('service status', () => {
  it('is Working when the latest check passed at the usual speed', () => {
    expect(statusOf(media())).toMatchObject({
      state: 'working',
      word: 'Working',
      tone: 'success',
      source: 'Measured',
      showSource: false,
      failing: false,
      failRun: 0,
    })
  })

  it('is Check failed with the run, the start and the reason', () => {
    const status = statusOf(media({ results: results(10, { last: 60, failing: [50, 55, 60] }) }))
    expect(status).toMatchObject({
      state: 'failed',
      word: 'Check failed',
      failRun: 3,
      failingSince: at(50),
    })
    expect(status.why[0]?.text).toBe('answered with error 503; it needs a code below 500')
  })

  it('takes the start of a long failure from its event when every kept check failed', () => {
    const failing = [40, 45, 50, 55, 60]
    const status = statusOf(
      media({
        results: results(5, { last: 60, failing }),
        events: [event('START', -600), event('UNHEALTHY', 12)],
      }),
    )
    expect(status.failingSince).toBe(at(12))
  })

  it('is Slower than usual, measured, when now is 1.5 times usual or more', () => {
    expect(
      statusOf(media({ results: results(10, { last: 60, ms: 640 }), usualMs: 160 })),
    ).toMatchObject({
      state: 'slow',
      word: 'Slower than usual',
      source: 'Measured',
      showSource: true,
    })
  })

  it('is No checks yet without results, and Check late when the newest check is overdue', () => {
    expect(statusOf(media({ results: [] }))).toMatchObject({ state: 'no-checks', source: null })
    expect(statusOf(media(), { when: at(71) })).toMatchObject({
      state: 'late',
      word: 'Check late',
      late: true,
    })
    expect(statusOf(media(), { when: at(70) }).state).toBe('working')
  })

  it('keeps a worse measured state when a check is also late', () => {
    const status = statusOf(media({ results: results(10, { last: 60, failing: [60] }) }), {
      when: at(90),
    })
    expect(status).toMatchObject({ state: 'failed', late: true })
  })
})

describe('reports and maintenance', () => {
  function reported(impact: 'major' | 'partial' | 'degraded' | 'maintenance') {
    return [report({ endpoints: [{ key: 'media', name: 'Media', impact }] })]
  }

  it.each([
    ['major', 'down', 'Down', 'Reported'],
    ['partial', 'partial', 'Partly down', 'Reported'],
    ['degraded', 'degraded', 'Degraded', 'Reported'],
    ['maintenance', 'maintenance', 'Maintenance', 'Reported'],
  ] as const)('takes %s from a report', (impact, state, word, source) => {
    expect(statusOf(media(), { reports: reported(impact) })).toMatchObject({
      state,
      word,
      source,
      showSource: true,
      reported: { impact, report: { id: 'r1' } },
    })
  })

  it('says Slower than usual, reported and measured, when a degraded service is measured slow', () => {
    const slow = media({ results: results(10, { last: 60, ms: 1200 }) })
    expect(statusOf(slow, { reports: reported('degraded') })).toMatchObject({
      state: 'degraded',
      word: 'Slower than usual',
      source: 'Reported and measured',
    })
  })

  it('ranks a reported outage above a failed check, and says both sources', () => {
    const failing = media({ results: results(10, { last: 60, failing: [60] }) })
    expect(statusOf(failing, { reports: reported('major') })).toMatchObject({
      state: 'down',
      source: 'Reported and measured',
    })
    expect(statusOf(failing, { reports: reported('partial') }).state).toBe('failed')
  })

  it('ignores reports that are not open at the moment', () => {
    expect(statusOf(media(), { reports: reported('major'), when: at(40) }).state).toBe('working')
  })

  it('ignores a report about a service this page does not monitor', () => {
    const elsewhere = [report({ endpoints: [{ key: 'search', name: 'Search', impact: 'major' }] })]
    expect(statusOf(media(), { reports: elsewhere })).toMatchObject({
      state: 'working',
      reported: null,
    })
  })

  it('shows maintenance with its end time, as scheduled', () => {
    expect(statusOf(media(), { windows: [upgrade] })).toMatchObject({
      state: 'maintenance',
      word: 'Maintenance until 15:00 UTC',
      source: 'Scheduled',
      tone: 'neutral',
    })
    expect(statusOf(media(), { windows: [upgrade], when: at(120) }).state).toBe('late')
  })

  it('shows a failure during maintenance, keeping the window', () => {
    const failing = media({ results: results(10, { last: 60, failing: [60] }) })
    expect(statusOf(failing, { windows: [upgrade] })).toMatchObject({
      state: 'failed',
      maintenance: { title: 'Media upgrade' },
    })
  })

  it('covers every service with a window that names none', () => {
    expect(statusOf(media(), { windows: [{ ...upgrade, endpoints: [] }] }).state).toBe(
      'maintenance',
    )
  })
})

describe('serviceInputs', () => {
  it('joins statuses with events and usual speeds, keeping missing events missing', () => {
    const events = new Map([['media', [event('START', 0)]]])
    const usual = new Map([['media', 70]])
    const inputs = serviceInputs(
      [
        { key: 'media', name: 'Media', group: 'Supporting services', results: [] },
        { key: 'blog', results: [] },
      ],
      events,
      usual,
    )
    expect(inputs[0]).toMatchObject({ name: 'Media', usualMs: 70, events: [{ type: 'START' }] })
    expect(inputs[1]).toEqual({ key: 'blog', name: 'blog', group: '', results: [], usualMs: null })
  })
})
