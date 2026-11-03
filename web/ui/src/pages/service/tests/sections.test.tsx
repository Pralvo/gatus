// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { at, event, result, results } from '../../../test/fixtures'
import { pralvoEstate, renderHome, requested, setNow, type Estate } from '../../home/tests/harness'

import { serveService, steadyHistory } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

function media(): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name: 'Media' })
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

describe('response time', () => {
  it('switches between 24 hours, 7 days and 30 days', async () => {
    setNow()
    const mock = serveService(pralvoEstate(), {
      histories: { 'media 30d': steadyHistory(90, 24 * 20) },
    })
    const { user } = renderHome('/endpoints/media')
    await media()
    const part = section('Response time')
    expect(await within(part).findByText(/^Hourly averages over the last 24 hours/)).toBeVisible()
    expect(within(part).getByRole('button', { name: '24 hours' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(part).getByRole('button', { name: '30 days' }))
    expect(
      await within(part).findByText(/^Hourly averages over the last 30 days: median 90 ms/),
    ).toBeVisible()
    expect(within(part).getByRole('button', { name: '30 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(requested(mock)).toContain('/api/v1/endpoints/media/response-times/30d/history')
    await user.click(within(part).getByRole('button', { name: '7 days' }))
    expect(await within(part).findByText(/^Hourly averages over the last 7 days/)).toBeVisible()
  })

  it('shows the chart as a table and back, with failed periods', async () => {
    setNow()
    const estate: Estate = {
      ...pralvoEstate(),
      events: { media: [event('START', -3000), event('UNHEALTHY', 0), event('HEALTHY', 20)] },
    }
    serveService(estate)
    const { user } = renderHome('/endpoints/media')
    await media()
    const part = section('Response time')
    const chart = await within(part).findByRole('img', {
      name: /Shaded: 1 period of failed checks\.$/,
    })
    expect(chart.querySelectorAll('[data-failed]')).toHaveLength(1)
    await user.click(within(part).getByRole('button', { name: 'Show as table' }))
    expect(within(part).queryByRole('img')).toBeNull()
    const table = within(part).getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(25)
    expect(within(table).getByRole('row', { name: '13:00 UTC 70 ms 20 minutes' })).toBeVisible()
    await user.click(within(part).getByRole('button', { name: 'Show as chart' }))
    expect(within(part).getByRole('img')).toBeVisible()
  })
})

describe('recent checks', () => {
  it('pages through Gatus result pages, 50 at a time', async () => {
    setNow()
    const kept = results(100, { last: 60, every: 1, failing: [60] })
    const mock = serveService(pralvoEstate(), { pages: { media: kept } })
    const { user } = renderHome('/endpoints/media')
    await media()
    const part = section('Recent checks')
    const table = await within(part).findByRole('table')
    expect(table).toHaveTextContent('Checks 1 to 50, newest first.')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(51)
    expect(rows[1]).toHaveTextContent(
      '14:00 UTCFailed70 msanswered with error 503; it needs a code below 500',
    )
    expect(rows[2]).toHaveTextContent('13:59 UTCPassed70 ms—')
    expect(within(part).getByRole('button', { name: 'Newer checks' })).toBeDisabled()
    await user.click(within(part).getByRole('button', { name: 'Older checks' }))
    expect(await within(part).findByText(/^Checks 51 to 100, newest first\./)).toBeVisible()
    expect(within(part).getAllByRole('row')[1]).toHaveTextContent('13:10 UTC')
    expect(within(part).getByRole('button', { name: 'Older checks' })).toBeDisabled()
    expect(
      requested(mock).filter((path) => path === '/api/v1/endpoints/media/statuses'),
    ).not.toHaveLength(0)
    await user.click(within(part).getByRole('button', { name: 'Newer checks' }))
    expect(await within(part).findByText(/^Checks 1 to 50, newest first\./)).toBeVisible()
  })

  it('gives the strip one tab stop with a full-sentence name', async () => {
    setNow()
    serveService(pralvoEstate())
    renderHome('/endpoints/media')
    await media()
    const strip = within(section('Recent checks')).getByRole('group', {
      name: 'Last 12 checks of Media. Use the arrow keys to read each check.',
    })
    expect(strip).toHaveAttribute('tabindex', '0')
  })
})

describe('record, history and badges', () => {
  it('shows the record of this service only, and its history', async () => {
    setNow()
    const estate: Estate = {
      ...pralvoEstate(),
      events: {
        media: [event('START', -3000), event('UNHEALTHY', 40), event('HEALTHY', 58)],
      },
    }
    serveService(estate)
    renderHome('/endpoints/media')
    await media()
    expect(
      await screen.findByRole('group', { name: 'Daily record of Media, 91 days' }),
    ).toBeVisible()
    const history = section('History')
    expect(
      await within(history).findByText('Checks passed again, after 18 minutes of failed checks.'),
    ).toBeVisible()
    expect(within(history).getByText('Checks began failing.')).toBeVisible()
    expect(within(history).getByText('Monitoring began.')).toBeVisible()
  })

  it('copies absolute badge addresses', async () => {
    setNow()
    serveService(pralvoEstate())
    const { user } = renderHome('/endpoints/media')
    await media()
    await user.click(screen.getByText('Embed a badge'))
    await user.click(
      screen.getByRole('button', { name: 'Copy the uptime, 7 days badge address for Media' }),
    )
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/api/v1/endpoints/media/uptimes/7d/badge.svg`,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Badge address copied.')
    await user.click(
      screen.getByRole('button', { name: 'Copy the health badge address for Media' }),
    )
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/api/v1/endpoints/media/health/badge.svg`,
    )
  })
})

describe('hostile server text', () => {
  it('shows names and conditions as text, never as markup', async () => {
    setNow()
    const name = '<img src=x onerror=alert(1)>'
    const condition = '[BODY].status == <script>alert(1)</script>'
    const estate = pralvoEstate()
    const hostile: Estate = {
      ...estate,
      statuses: estate.statuses.map((status) =>
        status.key === 'media'
          ? {
              ...status,
              name,
              group: '<b>group</b>',
              results: [
                result({ minute: 55, conditions: [{ condition, success: true }] }),
                result({ minute: 60, ok: false, conditions: [{ condition, success: false }] }),
              ],
            }
          : status,
      ),
    }
    serveService(hostile)
    renderHome('/endpoints/media')
    expect(await screen.findByRole('heading', { level: 1, name })).toBeVisible()
    expect(document.title).toBe(`${name} · Pralvo status`)
    expect(screen.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveTextContent(
      '<b>group</b>',
    )
    expect(screen.getByRole('region', { name: 'Current state' })).toHaveTextContent(
      `Why: ${condition}.`,
    )
    expect(
      within(section('What “working” means')).getByText(condition, { selector: 'code' }),
    ).toBeVisible()
    const main = screen.getByRole('main')
    expect(main.querySelector('img[src="x"]')).toBeNull()
    expect(main.querySelector('script')).toBeNull()
    expect(main.querySelector('b')).toBeNull()
  })
})

describe('time travel', () => {
  it('shows the service as it stood, read-only', async () => {
    setNow(at(75))
    const estate: Estate = {
      ...pralvoEstate({ media: [45, 50] }),
      events: { media: [event('START', -3000), event('UNHEALTHY', 40), event('HEALTHY', 52)] },
    }
    serveService(estate)
    renderHome('/endpoints/media?at=2026-11-02T13:50Z')
    await media()
    const banner = screen.getByRole('region', { name: 'Time travel' })
    expect(banner).toHaveTextContent('You are looking at 2 Nov 2026, 13:50 UTC.')
    expect(within(banner).getByRole('link', { name: 'Back to now' })).toHaveAttribute(
      'href',
      '/endpoints/media',
    )
    await waitFor(() => {
      expect(document.title).toBe('Media · 2 Nov 13:50 UTC · Pralvo status')
    })
    const state = screen.getByRole('region', { name: 'Current state' })
    expect(within(state).getByText('Check failed')).toBeVisible()
    expect(state).toHaveTextContent('Failed its last 2 checks, since 13:45 UTC.')
    expect(state).not.toHaveTextContent('refreshes every minute')
    expect(screen.queryByText('Embed a badge')).toBeNull()
    expect(section('Compared with normal')).not.toHaveTextContent('Failed checks (30 days)')
    const table = await within(section('Recent checks')).findByRole('table')
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('13:50 UTC')
  })

  it('moves focus to the H1 when arriving from the home page', async () => {
    setNow()
    serveService(pralvoEstate())
    const { user } = renderHome('/')
    await user.click(await screen.findByRole('link', { name: 'Media' }))
    const heading = await media()
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
  })
})
