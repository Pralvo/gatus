// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../../../data/cycle'
import { at, event, report } from '../../../test/fixtures'

import { pralvoEstate, renderHome, requested, serve, setNow } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
})

function travelEstate() {
  const estate = pralvoEstate({ media: [40, 45, 50, 55, 60] })
  estate.events = {
    ...estate.events,
    media: [event('START', -60 * 24 * 20), event('UNHEALTHY', 40)],
  }
  estate.reports = [report()]
  return estate
}

describe('time travel', () => {
  it('shows the page as it stood, read-only, with the banner', async () => {
    setNow(at(75))
    const fetchMock = serve(travelEstate())
    renderHome('/?at=2026-11-02T13:50Z')
    const banner = await screen.findByRole('region', { name: 'Time travel' })
    expect(banner).toHaveTextContent(
      'You are looking at 2 Nov 2026, 13:50 UTC. This view is rebuilt from the record: checks, reports and maintenance.',
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Media had failed its latest check' }),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Its checks had failed since 13:40 UTC: answered with error 503; it needs a code below 500.',
      ),
    ).toBeVisible()
    expect(document.title).toBe('2 Nov 13:50 UTC · Pralvo status')
    expect(screen.queryByRole('button', { name: 'Refresh now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Is it just me?' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Now' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'What was happening at that moment' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Media' })).toHaveAttribute(
      'href',
      '/endpoints/media?at=2026-11-02T13:50Z',
    )
    await waitFor(() => {
      expect(requested(fetchMock)).toContain('/api/v1/reports/r1')
    })
    expect(within(banner).getByRole('link', { name: 'Back to now' })).toHaveAttribute('href', '/')
  })

  it('copies the link and the ticket text', async () => {
    setNow(at(75))
    serve(travelEstate())
    const { user } = renderHome('/?at=2026-11-02T13:50:42Z')
    await screen.findByRole('heading', { level: 1, name: 'Media had failed its latest check' })
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/?at=2026-11-02T13:50Z`,
    )
    expect(screen.getByText('Link copied.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy for a ticket' }))
    expect(await navigator.clipboard.readText()).toBe(
      [
        'Pralvo status at 2 Nov 2026, 13:50 UTC:',
        'Media had failed its latest check.',
        'Its checks had failed since 13:40 UTC: answered with error 503; it needs a code below 500.',
        'Report: “Images were slow to load” (Investigating, 13:44 UTC).',
        `${window.location.origin}/?at=2026-11-02T13:50Z`,
      ].join('\n'),
    )
  })

  it('stops refreshing', async () => {
    setNow(at(75))
    serve(travelEstate())
    const { client } = renderHome('/?at=2026-11-02T13:50Z')
    await screen.findByRole('heading', { level: 1, name: 'Media had failed its latest check' })
    const intervals = client
      .getQueryCache()
      .findAll({ queryKey: queryKeys.statuses(100) })
      .flatMap((query) => query.observers.map((observer) => observer.options.refetchInterval))
    expect(intervals).toEqual([false])
  })

  it('says when check details for the moment are no longer kept', async () => {
    setNow(at(75))
    serve(travelEstate())
    renderHome('/?at=2026-11-01T09:00Z')
    expect(
      await screen.findByText(
        'Check details for this time are no longer kept. The record keeps when each service started and stopped failing.',
      ),
    ).toBeVisible()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Everything was working' }),
    ).toBeVisible()
  })

  it.each([
    ['not a time', '/?at=yesterday'],
    ['in the future', '/?at=2026-11-02T15:00Z'],
  ])('shows the message for a time %s, over the live page', async (_name, path) => {
    setNow(at(75))
    serve(travelEstate())
    renderHome(path)
    const banner = await screen.findByRole('region', { name: 'Time travel' })
    await waitFor(() => {
      expect(banner).toHaveTextContent('Choose a time between 13 Oct 2026 and now, in UTC.')
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Media failed its latest check' }),
    ).toBeVisible()
    expect(within(banner).getByRole('link', { name: 'Back to now' })).toHaveAttribute('href', '/')
  })

  it('opens a moment from the "Now" picker and moves focus to the H1', async () => {
    setNow(at(75))
    serve(travelEstate())
    const { user } = renderHome('/')
    await screen.findByRole('heading', { level: 1, name: 'Media failed its latest check' })
    await user.click(screen.getByRole('button', { name: 'Now' }))
    const dialog = await screen.findByRole('dialog', { name: 'Look at another moment' })
    const field = within(dialog).getByLabelText('Moment (UTC)')
    expect(field).toHaveValue('2026-11-02T14:15')
    expect(within(dialog).getByText('The record starts on 13 Oct 2026.')).toBeVisible()
    await user.clear(field)
    await user.type(field, '2026-11-03T10:00')
    await user.click(within(dialog).getByRole('button', { name: 'Show this moment' }))
    expect(
      within(dialog).getByText('Choose a time between 13 Oct 2026 and now, in UTC.'),
    ).toBeVisible()
    await user.clear(field)
    await user.type(field, '2026-11-02T13:50')
    await user.click(within(dialog).getByRole('button', { name: 'Show this moment' }))
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Media had failed its latest check',
    })
    expect(window.location.search).toBe('?at=2026-11-02T13:50Z')
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
  })

  it('copies a link to now', async () => {
    setNow(at(75))
    serve(travelEstate())
    const { user } = renderHome('/')
    await screen.findByRole('heading', { level: 1, name: 'Media failed its latest check' })
    await user.click(screen.getByRole('button', { name: 'Now' }))
    const dialog = await screen.findByRole('dialog', { name: 'Look at another moment' })
    await user.click(within(dialog).getByRole('button', { name: 'Copy link to now' }))
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/?at=2026-11-02T14:15Z`,
    )
  })
})
