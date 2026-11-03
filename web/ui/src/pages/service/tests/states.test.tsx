// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MaintenanceWindow } from '../../../api/plugins/types'
import { at, report, results } from '../../../test/fixtures'
import { pralvoEstate, renderHome, setNow, type Estate } from '../../home/tests/harness'

import { serveService } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

/** The home estate with Media's kept results replaced. */
function withMedia(estate: Estate, kept: ReturnType<typeof results>): Estate {
  return {
    ...estate,
    statuses: estate.statuses.map((status) =>
      status.key === 'media' ? { ...status, results: kept } : status,
    ),
  }
}

function panel(): HTMLElement {
  return screen.getByRole('region', { name: 'Current state' })
}

function media(): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name: 'Media' })
}

describe('service page states', () => {
  it('shows a working service with its figures and what working means', async () => {
    setNow()
    serveService(pralvoEstate())
    renderHome('/endpoints/media')
    await media()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toBe('Media · Pralvo status')
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumbs' })
    expect(within(crumbs).getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/')
    expect(crumbs).toHaveTextContent('Supporting services')
    expect(within(panel()).getByText('Working')).toBeVisible()
    expect(within(panel()).getByText('Measured')).toBeVisible()
    expect(panel()).toHaveTextContent('The latest check passed at 14:00 UTC. Steady.')
    expect(panel()).toHaveTextContent('Updated just now · refreshes every minute')
    const normal = screen.getByRole('region', { name: 'Compared with normal' })
    expect(normal).toHaveTextContent('Now (last 3 passing checks)70 ms')
    expect(normal).toHaveTextContent('Usual (median, 7 days)70 ms')
    expect(await within(normal).findByText('0.5%')).toBeVisible()
    expect(normal).toHaveTextContent('As fast as usual: 70 ms now, 70 ms usually.')
    expect(screen.getByRole('region', { name: 'What “working” means' })).toHaveTextContent(
      'It answers without a server error (any code below 500).',
    )
    expect(
      await screen.findByRole('img', { name: /^Hourly averages over the last 24 hours/ }),
    ).toBeVisible()
  })

  it('shows a failed check with the run and why', async () => {
    setNow()
    serveService(pralvoEstate({ media: [50, 55, 60] }))
    renderHome('/endpoints/media')
    await media()
    expect(within(panel()).getByText('Check failed')).toBeVisible()
    expect(panel()).toHaveTextContent(
      'Failed its last 3 checks, since 13:50 UTC. Why: answered with error 503; it needs a code below 500.',
    )
    expect(panel().dataset.tone).toBe('danger')
  })

  it('shows slower than usual from the checks', async () => {
    setNow()
    serveService(withMedia(pralvoEstate(), results(12, { last: 60, ms: 700 })))
    renderHome('/endpoints/media')
    await media()
    expect(within(panel()).getByText('Slower than usual')).toBeVisible()
    expect(panel()).toHaveTextContent('Measured: 700 ms now, 70 ms usually. Its checks still pass.')
    expect(screen.getByRole('region', { name: 'Compared with normal' })).toHaveTextContent(
      'Much slower than usual: 700 ms now, 70 ms usually.',
    )
  })

  it('shows maintenance in progress', async () => {
    setNow()
    const window: MaintenanceWindow = {
      title: 'Storage move',
      start: at(30),
      end: at(120),
      state: 'in-progress',
      endpoints: [{ key: 'media', name: 'Media' }],
    }
    serveService({ ...pralvoEstate(), windows: [window] })
    renderHome('/endpoints/media')
    await media()
    expect(await within(panel()).findByText('Maintenance until 15:00 UTC')).toBeVisible()
    expect(within(panel()).getByText('Scheduled')).toBeVisible()
    expect(panel()).toHaveTextContent(
      '“Storage move”. Checks keep running, so a failure still shows.',
    )
  })

  it('shows what a report says', async () => {
    setNow()
    serveService({ ...pralvoEstate(), reports: [report()] })
    renderHome('/endpoints/media')
    await media()
    expect(await within(panel()).findByText('Degraded')).toBeVisible()
    expect(within(panel()).getByText('Reported')).toBeVisible()
    expect(panel()).toHaveTextContent('Reported at 13:44 UTC: “Images were slow to load”.')
  })

  it('says when no check has run yet', async () => {
    setNow()
    serveService(withMedia(pralvoEstate(), []))
    renderHome('/endpoints/media')
    await media()
    expect(within(panel()).getByText('No checks yet')).toBeVisible()
    expect(panel()).toHaveTextContent('The first check has not finished yet.')
    expect(screen.getByRole('region', { name: 'What “working” means' })).toHaveTextContent(
      'The first check has not finished yet, so what it tests is not known.',
    )
    expect(screen.getByRole('region', { name: 'Compared with normal' })).toHaveTextContent(
      'Not enough checks to compare.',
    )
  })

  it('hides the chart and speeds for a check that does not measure response time', async () => {
    setNow()
    serveService(withMedia(pralvoEstate(), results(12, { last: 60, ms: 0 })))
    renderHome('/endpoints/media')
    await media()
    const normal = screen.getByRole('region', { name: 'Compared with normal' })
    expect(normal).toHaveTextContent('This check does not measure response time.')
    expect(normal).not.toHaveTextContent('Now (last 3 passing checks)')
    expect(normal).toHaveTextContent('Failed checks (30 days)')
    expect(screen.queryByRole('heading', { name: 'Response time' })).toBeNull()
  })

  it('says the monitor may be out of date', async () => {
    setNow(at(90))
    serveService(pralvoEstate())
    renderHome('/endpoints/media')
    await media()
    expect(panel()).toHaveTextContent('Last check 30 minutes ago, at 14:00 UTC.')
    expect(panel()).toHaveTextContent('Newest check 30 minutes ago')
  })

  it('says there is no service at an unknown address, without spinning', async () => {
    setNow()
    serveService(pralvoEstate())
    renderHome('/endpoints/no-such-service')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'There is no service at this address' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the status page' })).toHaveAttribute('href', '/')
    expect(document.title).toBe('Not found · Pralvo status')
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('shows a hidden H1 while loading', () => {
    setNow()
    serveService({ ...pralvoEstate(), hanging: new Set(['/api/v1/endpoints/statuses']) })
    renderHome('/endpoints/media')
    expect(screen.getByRole('heading', { level: 1, name: 'Loading service' })).toBeInTheDocument()
    expect(document.title).toBe('Loading service · Pralvo status')
  })

  it('offers to try again when the statuses fail, and recovers', async () => {
    setNow()
    const estate: Estate = { ...pralvoEstate(), failing: new Set(['/api/v1/endpoints/statuses']) }
    serveService(estate)
    const { user } = renderHome('/endpoints/media')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Status unavailable' }),
    ).toBeVisible()
    expect(
      screen.getByText('This page could not load the service status. Try again in a minute.'),
    ).toBeVisible()
    estate.failing = new Set()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await media()).toBeVisible()
  })
})
