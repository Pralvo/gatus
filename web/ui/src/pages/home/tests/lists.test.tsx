// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { at, event, report, results } from '../../../test/fixtures'

import { pralvoEstate, renderHome, serve, setNow } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

/** Nine services: one above the limit for the search bar. */
function bigEstate() {
  const estate = pralvoEstate({ media: [60] })
  for (const index of [1, 2, 3, 4]) {
    estate.statuses.push({
      key: `api-${String(index)}`,
      name: `API ${String(index)}`,
      group: 'Interfaces',
      results: results(12, { last: 60 }),
    })
  }
  return estate
}

async function loaded() {
  await screen.findByRole('heading', { level: 1, name: (name) => name !== 'Loading status' })
}

function rowNames(): string[] {
  const section = screen.getByRole('region', { name: 'Services' })
  return within(section)
    .getAllByRole('listitem')
    .map((item) => within(item).getAllByRole('link')[0]?.textContent ?? '')
}

describe('services list', () => {
  it('shows search, filter and sort only above 8 services', async () => {
    setNow()
    serve(pralvoEstate())
    renderHome()
    await loaded()
    expect(screen.queryByRole('searchbox', { name: 'Search' })).toBeNull()
  })

  it('searches into ?q= and filters into Gatus storage keys', async () => {
    setNow()
    serve(bigEstate())
    const { user } = renderHome()
    await loaded()
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'api')
    await waitFor(() => {
      expect(window.location.search).toBe('?q=api')
    })
    expect(rowNames()).toEqual(['API 1', 'API 2', 'API 3', 'API 4'])
    await user.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter' }), 'failing')
    expect(window.localStorage.getItem('gatus:filter-by')).toBe('failing')
    expect(rowNames()).toEqual(['Media'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name')
    expect(window.localStorage.getItem('gatus:sort-by')).toBe('name')
  })

  it('reads earlier choices and says when nothing matches', async () => {
    setNow()
    window.localStorage.setItem('gatus:sort-by', 'health')
    serve(bigEstate())
    const { user } = renderHome('/?q=zzz')
    await loaded()
    expect(screen.getByText('No services match. Clear the search or show all.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show all' }))
    expect(rowNames()[0]).toBe('Media')
    expect(rowNames()).toHaveLength(9)
  })

  it('collapses a group and remembers it', async () => {
    setNow()
    serve(pralvoEstate())
    const { user } = renderHome()
    await loaded()
    const toggle = screen.getByRole('button', { name: 'Hide Public site' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Show Public site' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('link', { name: 'Website' })).toBeNull()
    expect(window.localStorage.getItem('pralvo:collapsed-groups')).toBe('["Public site"]')
  })
})

describe('track record', () => {
  function recordEstate() {
    const estate = pralvoEstate()
    estate.events = {
      ...estate.events,
      media: [event('START', -60 * 24 * 20), event('UNHEALTHY', 40), event('HEALTHY', 58)],
    }
    estate.reports = [report({ stage: 'resolved', resolvedAt: at(59), updatedAt: at(59) })]
    return estate
  }

  it('filters by service and shows a chosen day with its links', async () => {
    setNow()
    serve(recordEstate())
    const { user } = renderHome()
    await loaded()
    const grid = await screen.findByRole('group', { name: 'Daily record, 91 days' })
    const today = within(grid).getAllByRole('button').at(-1) as HTMLElement
    expect(today).toHaveAccessibleName(
      '2 Nov: Media failed checks for 18 minutes (13:40 to 13:58 UTC). Report: “Images were slow to load”.',
    )
    await user.click(today)
    const detail = screen.getByText(/^2 Nov: Media failed checks/).parentElement as HTMLElement
    expect(within(detail).getByRole('link', { name: 'Read the story' })).toHaveAttribute(
      'href',
      '/reports/r1',
    )
    expect(within(detail).getByRole('link', { name: 'See the page at 13:49 UTC' })).toHaveAttribute(
      'href',
      '/?at=2026-11-02T13:49Z',
    )
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'website')
    const filtered = screen.getByRole('group', { name: 'Daily record, 91 days' })
    expect(within(filtered).getAllByRole('button').at(-1)).toHaveAccessibleName(
      '2 Nov: no failed checks.',
    )
  })

  const finished = (title: string, month: number, day: number) => ({
    title,
    start: Date.UTC(2026, month - 1, day, 10),
    end: Date.UTC(2026, month - 1, day, 11),
    state: 'finished' as const,
    endpoints: [],
  })
  function noticesEstate() {
    const estate = recordEstate()
    estate.windows = [finished('Media move', 10, 15), finished('Database upgrade', 9, 20)]
    return estate
  }
  // The kind switch is a list of buttons too, so read the days from the month lists.
  const daysIn = (region: HTMLElement) => [...region.querySelectorAll('ol > li')]
  const monthsIn = (region: HTMLElement) =>
    within(region)
      .queryAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)

  it('lists past notices by month, only on days that have some, and shows older months', async () => {
    setNow()
    serve(noticesEstate())
    const { user } = renderHome()
    await loaded()
    const notices = screen.getByRole('region', { name: 'Past notices' })
    expect(monthsIn(notices)).toEqual(['November 2026', 'October 2026'])
    const days = daysIn(notices)
    expect(days).toHaveLength(2)
    expect(days[0]).toHaveTextContent('2 NovResolved13:59 UTCImages were slow to load')
    expect(days[1]).toHaveTextContent(/^15 OctMaintenance finished.*Media move$/)
    await user.click(within(notices).getByRole('button', { name: 'Show older notices' }))
    expect(monthsIn(notices)).toEqual(['November 2026', 'October 2026', 'September 2026'])
    expect(window.location.search).toBe('?months=3')
    expect(within(notices).queryByRole('button', { name: 'Show older notices' })).toBeNull()
  })

  it('filters past notices by kind, state and title, and keeps the view in the address', async () => {
    setNow()
    serve(noticesEstate())
    const { user } = renderHome()
    await loaded()
    const notices = screen.getByRole('region', { name: 'Past notices' })
    await user.click(within(notices).getByRole('button', { name: 'Maintenance' }))
    expect(within(notices).queryByRole('link', { name: 'Images were slow to load' })).toBeNull()
    expect(monthsIn(notices)).toEqual(['October 2026'])
    expect(window.location.search).toBe('?kind=maintenance')
    await user.selectOptions(within(notices).getByRole('combobox', { name: 'State' }), 'unresolved')
    expect(
      within(notices).getByText('No notices match these filters since October 2026.'),
    ).toBeVisible()
    await user.selectOptions(within(notices).getByRole('combobox', { name: 'State' }), 'all')
    await user.type(within(notices).getByRole('searchbox', { name: 'Search titles' }), 'MEDIA mo')
    expect(daysIn(notices)).toHaveLength(1)
    expect(window.location.search).toBe('?kind=maintenance&search=MEDIA+mo')
    expect(within(notices).getByRole('searchbox', { name: 'Search titles' })).toHaveFocus()
  })

  it('opens a shared view from the address, ignoring values it cannot read', async () => {
    setNow()
    serve(noticesEstate())
    renderHome('/?kind=reports&state=nonsense&search=images&months=x')
    await loaded()
    const notices = screen.getByRole('region', { name: 'Past notices' })
    expect(monthsIn(notices)).toEqual(['November 2026'])
    expect(within(notices).getByRole('link', { name: 'Images were slow to load' })).toBeVisible()
    expect(within(notices).getByRole('combobox', { name: 'State' })).toHaveValue('all')
    expect(within(notices).getByRole('searchbox', { name: 'Search titles' })).toHaveValue('images')
  })
})
