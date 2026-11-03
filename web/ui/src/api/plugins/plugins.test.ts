import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpError, ResponseFormatError } from '../http'

import { getMaintenance } from './maintenance'
import { getReport, getReports } from './reports'

function answer(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  )
}

function requestedUrl(): string {
  return vi.mocked(fetch).mock.calls[0]?.[0] as string
}

const report = {
  id: 'r1',
  title: 'Images were slow to load',
  stage: 'identified',
  endpoints: [{ key: 'supporting-services_media', name: 'Media', impact: 'degraded' }],
  updates: [
    { stage: 'investigating', at: '2026-11-02T13:44:00Z', message: 'Looking.' },
    { stage: 'identified', at: '2026-11-02T13:51:00Z', message: 'Found it.' },
  ],
  publishedAt: '2026-11-02T13:44:00Z',
  updatedAt: '2026-11-02T13:51:00Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getReports', () => {
  it('asks for the page and turns times into milliseconds, newest update first', async () => {
    answer({ reports: [report], page: 2, more: true })
    const page = await getReports(2)
    expect(requestedUrl()).toBe('/api/v1/reports?page=2')
    expect(page.more).toBe(true)
    expect(page.reports[0]?.publishedAt).toBe(Date.UTC(2026, 10, 2, 13, 44))
    expect(page.reports[0]?.updates.map((update) => update.stage)).toEqual([
      'identified',
      'investigating',
    ])
  })

  it('drops reports and parts it cannot trust, keeping the rest', async () => {
    answer({
      reports: [
        report,
        { ...report, id: '' },
        { ...report, stage: 'panicking' },
        { ...report, publishedAt: 'yesterday' },
        { ...report, publishedAt: '2026-11-02' },
        { ...report, publishedAt: 'Nov 2, 2026 13:44' },
        { ...report, publishedAt: '2026-11-02T13:44:00' },
        'not a report',
        {
          ...report,
          id: 'r2',
          endpoints: [{ key: 'k', impact: 'catastrophic' }, { key: 'j', impact: 'major' }, null],
          updates: [{ stage: 'identified', at: 'later', message: 'x' }],
          resolvedAt: '2026-11-02T14:20:00Z',
        },
      ],
      page: 1,
      more: false,
    })
    const { reports } = await getReports()
    expect(reports.map((item) => item.id)).toEqual(['r1', 'r2'])
    expect(reports[1]?.endpoints).toEqual([{ key: 'j', name: 'j', impact: 'major' }])
    expect(reports[1]?.updates).toEqual([])
    expect(reports[1]?.resolvedAt).toBe(Date.UTC(2026, 10, 2, 14, 20))
  })

  it('refuses a body without a reports list', async () => {
    answer({ items: [] })
    await expect(getReports()).rejects.toBeInstanceOf(ResponseFormatError)
  })

  it.each([0, -1, 1.5])('refuses page %s before sending anything', async (page) => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(getReports(page)).rejects.toThrow(RangeError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes on the unavailable answer', async () => {
    answer({ error: 'reports are unavailable' }, 503)
    await expect(getReports()).rejects.toMatchObject({ status: 503 })
  })
})

describe('getReport', () => {
  it('encodes the id so it cannot change the path', async () => {
    answer(report)
    await getReport('../admin?x')
    expect(requestedUrl()).toBe('/api/v1/reports/..%2Fadmin%3Fx')
  })

  it('gives a 404 for a draft or unknown report', async () => {
    answer({ error: 'report not found' }, 404)
    await expect(getReport('nope')).rejects.toBeInstanceOf(HttpError)
  })

  it('refuses a body that is not a report', async () => {
    answer({ id: 'r1' })
    await expect(getReport('r1')).rejects.toBeInstanceOf(ResponseFormatError)
  })

  it('refuses an empty id', async () => {
    await expect(getReport('')).rejects.toThrow(RangeError)
  })
})

describe('getMaintenance', () => {
  const window = {
    title: 'Database upgrade',
    start: '2026-11-03T13:30:00Z',
    end: '2026-11-03T15:00:00Z',
    state: 'in-progress',
    details: 'Short.',
    endpoints: [{ key: 'supporting-services_database', name: 'Database' }],
  }

  it('reads windows, oldest start first', async () => {
    answer({
      windows: [window, { ...window, title: 'Earlier', start: '2026-11-01T10:00:00Z' }],
    })
    const windows = await getMaintenance()
    expect(requestedUrl()).toBe('/api/v1/maintenance')
    expect(windows.map((item) => item.title)).toEqual(['Earlier', 'Database upgrade'])
    expect(windows[1]?.details).toBe('Short.')
  })

  it('drops windows with a bad state, bad times or an end before the start', async () => {
    answer({
      windows: [
        { ...window, state: 'maybe' },
        { ...window, start: 'soon' },
        { ...window, end: '2026-11-03T13:00:00Z' },
        { ...window, endpoints: 'all', details: '' },
      ],
    })
    const windows = await getMaintenance()
    expect(windows).toHaveLength(1)
    expect(windows[0]?.endpoints).toEqual([])
    expect(windows[0]?.details).toBeUndefined()
  })

  it('refuses a body without a windows list', async () => {
    answer([])
    await expect(getMaintenance()).rejects.toBeInstanceOf(ResponseFormatError)
  })
})
