// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MaintenanceWindow } from '../../../api/plugins/types'
import { at, report } from '../../../test/fixtures'

import { pralvoConfig, pralvoEstate, renderHome, serve, setNow } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

function h1(): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name: (name) => name !== 'Loading status' })
}

function row(name: string): HTMLElement {
  const link = screen.getByRole('link', { name })
  const item = link.closest('li')
  if (item === null) {
    throw new Error(`no row for ${name}`)
  }
  return item
}

describe('home page', () => {
  it('shows everything working', async () => {
    setNow()
    serve(pralvoEstate())
    renderHome()
    expect(await h1()).toHaveTextContent('Everything is working')
    expect(
      screen.getByText('All 5 checks passed on their latest run, at their usual speed.'),
    ).toBeVisible()
    expect(document.title).toBe('Everything is working · Pralvo status')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'What is happening' })).toBeNull()
    expect(screen.getByText('2 services, all working')).toBeVisible()
    expect(screen.getByText('3 services, all working')).toBeVisible()
    expect(within(row('Media')).getByText('Working')).toBeVisible()
    expect(row('Media')).toHaveTextContent('As fast as usual: 70 ms now, 70 ms usually.')
    expect(screen.getByText('Updated just now · refreshes every minute')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Is it just me?' })).toBeVisible()
    expect(screen.queryByRole('searchbox', { name: 'Search' })).toBeNull()
    expect(await screen.findByRole('group', { name: 'Daily record, 91 days' })).toBeVisible()
  })

  it('explains the page in About, from the page settings and the checks', async () => {
    setNow()
    serve(pralvoEstate())
    renderHome()
    await h1()
    const about = screen.getByRole('region', { name: 'About this page' })
    expect(about).toHaveTextContent(
      'Checks run from one location in India. A problem that affects only some networks or countries may not show here; use “Is it just me?” to test from yours.',
    )
    expect(about).toHaveTextContent(
      'Website, Blog, Content system, Media and Database about every 5 minutes.',
    )
    expect(about).toHaveTextContent(
      'Media: It answers without a server error (any code below 500).',
    )
    expect(about).toHaveTextContent('1 minute ago, at 14:00 UTC.')
    expect(within(about).getByRole('link', { name: 'JSON Feed' })).toHaveAttribute(
      'href',
      '/feed/feed.json',
    )
  })

  it('leaves out where checks run when the page setting is empty', async () => {
    setNow()
    serve(pralvoEstate())
    renderHome('/', { ...pralvoConfig, checksLocation: '' })
    await h1()
    expect(screen.queryByText('Where checks run')).toBeNull()
  })

  it('shows a failed check: rank 3, the row, the story and tall slots', async () => {
    setNow()
    serve(pralvoEstate({ media: [50, 55, 60] }))
    renderHome()
    expect(await h1()).toHaveTextContent('Media failed its latest check')
    expect(
      screen.getByText(
        'It has failed its last 3 checks, since 13:50 UTC: answered with error 503; it needs a code below 500.',
      ),
    ).toBeVisible()
    expect(within(row('Media')).getByText('Check failed')).toBeVisible()
    expect(row('Media')).toHaveTextContent(
      'Failed its last 3 checks, since 13:50 UTC: answered with error 503; it needs a code below 500.',
    )
    expect(screen.getByText('Media: check failed')).toBeVisible()
    const strip = within(row('Media')).getByRole('group')
    expect(
      within(strip)
        .getAllByRole('img')
        .filter((slot) => slot.dataset.kind === 'failed'),
    ).toHaveLength(3)
    const story = screen.getByRole('region', { name: 'What is happening' })
    expect(within(story).getAllByText('Measured')).toHaveLength(2)
    expect(story).toHaveTextContent('Checks for Media began failing.')
    expect(screen.getByRole('button', { name: 'Is it just me?' }).dataset.variant).toBe('primary')
  })

  it('shows a reported degradation with its source', async () => {
    setNow()
    const estate = pralvoEstate()
    estate.reports = [report()]
    serve(estate)
    renderHome()
    expect(await h1()).toHaveTextContent('Media is degraded')
    expect(within(row('Media')).getByText('Degraded')).toBeVisible()
    expect(within(row('Media')).getByText('Reported')).toBeVisible()
    const story = screen.getByRole('region', { name: 'What is happening' })
    expect(story).toHaveTextContent('Investigating: “We are looking into it.”')
    expect(within(story).getByRole('link', { name: 'Read the report' })).toHaveAttribute(
      'href',
      '/reports/r1',
    )
  })

  it('shows maintenance in progress, scheduled', async () => {
    setNow()
    const estate = pralvoEstate()
    const window: MaintenanceWindow = {
      title: 'Database upgrade',
      start: at(30),
      end: at(120),
      state: 'in-progress',
      endpoints: [{ key: 'database', name: 'Database' }],
    }
    estate.windows = [window]
    serve(estate)
    renderHome()
    expect(await h1()).toHaveTextContent('Maintenance in progress')
    expect(within(row('Database')).getByText('Maintenance until 15:00 UTC')).toBeVisible()
    expect(within(row('Database')).getByText('Scheduled')).toBeVisible()
    expect(row('Database')).toHaveTextContent('“Database upgrade”. Checks keep running')
    expect(screen.getByText('Maintenance in progress', { selector: 'span' })).toBeVisible()
  })

  it('says when the page may be out of date', async () => {
    setNow(at(84))
    serve(pralvoEstate())
    renderHome()
    expect(await h1()).toHaveTextContent('Status may be out of date')
    expect(screen.getByText('Newest check 24 minutes ago')).toBeVisible()
    expect(within(row('Media')).getByText('Check late')).toBeVisible()
    expect(row('Media')).toHaveTextContent('Last check 24 minutes ago, at 14:00 UTC.')
    expect(within(row('Media')).getByRole('group').className).toContain('dimmed')
  })

  it('keeps the data and warns when a refresh fails', async () => {
    setNow()
    const estate = pralvoEstate()
    serve(estate)
    const { user } = renderHome()
    await h1()
    estate.failing = new Set(['/api/v1/endpoints/statuses'])
    await user.click(screen.getByRole('button', { name: 'Refresh now' }))
    expect(
      await screen.findByText(
        "Couldn't refresh. Showing data from 14:01 UTC. Trying again in 1 minute.",
      ),
    ).toBeVisible()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Everything is working')
    expect(row('Media')).toBeVisible()
  })

  it('announces a changed H1 once, politely, but not the first one', async () => {
    setNow()
    const estate = pralvoEstate()
    serve(estate)
    const { user } = renderHome()
    await h1()
    const panel = screen.getByRole('region', { name: 'Everything is working' })
    const live = panel.querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('')
    estate.statuses = pralvoEstate({ media: [60] }).statuses
    await user.click(screen.getByRole('button', { name: 'Refresh now' }))
    await waitFor(() => {
      expect(live).toHaveTextContent('Media failed its latest check')
    })
  })

  it('warns when reports or maintenance cannot load, and shows the checks', async () => {
    setNow()
    const estate = pralvoEstate({ media: [60] })
    estate.failing = new Set(['/api/v1/reports'])
    serve(estate)
    renderHome()
    expect(await h1()).toHaveTextContent('Media failed its latest check')
    expect(
      await screen.findByText(
        'Reports and maintenance could not be loaded. Service checks below are current.',
      ),
    ).toBeVisible()
    expect(screen.getAllByText('Not available right now.').length).toBeGreaterThan(0)
  })

  it('shows skeletons and a hidden H1 while loading', () => {
    setNow()
    const estate = pralvoEstate()
    estate.hanging = new Set(['/api/v1/endpoints/statuses'])
    serve(estate)
    renderHome()
    expect(screen.getByRole('heading', { level: 1, name: 'Loading status' })).toBeInTheDocument()
    expect(document.title).toBe('Loading status · Pralvo status')
    expect(screen.getByRole('region', { name: 'Services' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('region', { name: 'About this page' })).toBeNull()
  })

  it('says when nothing could be loaded, offers to try again and keeps About', async () => {
    setNow()
    const estate = pralvoEstate()
    estate.failing = new Set(['/api/v1/endpoints/statuses'])
    serve(estate)
    const { user } = renderHome()
    expect(await h1()).toHaveTextContent('Status unavailable')
    expect(
      screen.getByText('This page could not load the service status. Try again in a minute.'),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Services' })).toBeNull()
    expect(screen.getByRole('region', { name: 'About this page' })).toBeVisible()
    estate.failing = new Set()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Everything is working')
    })
  })

  it('says when no services are monitored', async () => {
    setNow()
    serve({ statuses: [] })
    renderHome()
    expect(await h1()).toHaveTextContent('No services are monitored on this page')
    expect(screen.queryByRole('heading', { name: 'Services' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Track record' })).toBeNull()
  })
})
