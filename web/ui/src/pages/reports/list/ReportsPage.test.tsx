// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { at, report } from '../../../test/fixtures'
import { answer, fetched, renderAt, startServer, stopServer, wire } from '../testing'

const commonCss = readFileSync(join(import.meta.dirname, '../common/common.module.css'), 'utf8')

beforeEach(startServer)
afterEach(stopServer)

const open = (id: string, minute: number, title = `Open ${id}`) =>
  wire(report({ id, title, updatedAt: at(minute) }))
const doneOn = (id: string, month: number, day: number) => {
  const when = Date.UTC(2026, month - 1, day, 12)
  return wire(
    report({
      id,
      title: `Done ${id}`,
      stage: 'resolved',
      updates: [{ stage: 'resolved', at: when, message: 'Fixed.' }],
      resolvedAt: when,
      updatedAt: when,
    }),
  )
}
const done = (id: string, minute: number) =>
  wire(
    report({
      id,
      title: `Done ${id}`,
      stage: 'resolved',
      updates: [{ stage: 'resolved', at: at(minute), message: 'Fixed.' }],
      resolvedAt: at(minute),
      updatedAt: at(minute),
    }),
  )

function page(reports: unknown[], number = 1, more = false) {
  answer(`/api/v1/reports?page=${String(number)}`, { reports, page: number, more })
}

function titlesIn(name: string, level = 3): string[] {
  const section = screen.getByRole('region', { name })
  return within(section)
    .getAllByRole('heading', { level })
    .map((heading) => heading.textContent)
}

describe('the reports list', () => {
  it('shows each report with its title link, stage in words, update time, latest words and services', async () => {
    page([open('o1', 50)])
    renderAt('/reports')
    const link = await screen.findByRole('link', { name: 'Open o1' })
    expect(link).toHaveAttribute('href', '/reports/o1')
    const item = link.closest('li')
    expect(item).not.toBeNull()
    const card = within(item as HTMLElement)
    expect(card.getByText('Investigating')).toBeVisible()
    expect(item).toHaveTextContent('Updated 2 Nov 2026, 13:50 UTC (40 minutes ago)')
    expect(card.getByText('We are looking into it.')).toBeVisible()
    expect(item).toHaveTextContent('Media: Degraded')
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible()
    expect(document.title).toBe('Reports · Pralvo status')
  })

  it('lists unresolved reports first, then the rest, each by most recent change', async () => {
    page([done('d1', 80), open('o1', 50), done('d2', 85), open('o2', 70)])
    renderAt('/reports')
    await screen.findByRole('heading', { level: 2, name: 'Active' })
    expect(titlesIn('Active')).toEqual(['Open o2', 'Open o1'])
    expect(titlesIn('Past', 4)).toEqual(['Done d2', 'Done d1'])
    expect(titlesIn('Past')).toEqual(['November 2026'])
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Active', 'Past'])
  })

  it('leaves out a heading with nothing under it', async () => {
    page([done('d1', 80)])
    renderAt('/reports')
    await screen.findByRole('heading', { level: 2, name: 'Past' })
    expect(screen.queryByRole('heading', { level: 2, name: 'Active' })).toBeNull()
  })

  it('says so when nothing has been published', async () => {
    page([])
    renderAt('/reports')
    expect(await screen.findByText('No reports have been published.')).toBeVisible()
    expect(screen.queryByRole('search', { name: 'Reports' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show older reports' })).toBeNull()
  })

  it('reads a server without the reports plugin as nothing published', async () => {
    answer('/api/v1/reports?page=1', 'not found', 404)
    renderAt('/reports')
    expect(await screen.findByText('No reports have been published.')).toBeVisible()
  })

  it('says reports are unavailable when the request fails, and tries again on request', async () => {
    answer('/api/v1/reports?page=1', 'down', 500)
    renderAt('/reports')
    expect(
      await screen.findByText(
        'Reports are unavailable right now. Service checks on the status page are not affected.',
      ),
    ).toBeVisible()
    page([open('o1', 50)])
    // Primer's Banner renders its action twice, one per layout; CSS shows one.
    const [retry] = screen.getAllByRole('button', { name: 'Try again' })
    await userEvent.setup().click(retry as HTMLElement)
    expect(await screen.findByRole('link', { name: 'Open o1' })).toBeVisible()
  })

  it('pages in older reports only as far as the months shown need', async () => {
    page([open('o1', 50), doneOn('d1', 10, 20)], 1, true)
    page([doneOn('d2', 10, 5), doneOn('d3', 8, 10)], 2, true)
    page([doneOn('d4', 7, 1)], 3, false)
    renderAt('/reports')
    expect(await screen.findByRole('link', { name: 'Done d2' })).toBeVisible()
    expect(fetched()).toEqual(['/api/v1/reports?page=1', '/api/v1/reports?page=2'])
    expect(titlesIn('Past')).toEqual(['October 2026'])
    expect(screen.queryByRole('link', { name: 'Done d3' })).toBeNull()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Show older reports' }))
    expect(window.location.search).toBe('?months=3')
    expect(screen.queryByRole('link', { name: 'Done d3' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show older reports' }))
    expect(await screen.findByRole('link', { name: 'Done d3' })).toBeVisible()
    await waitFor(() => {
      expect(fetched()).toContain('/api/v1/reports?page=3')
    })
    expect(screen.queryByRole('link', { name: 'Done d4' })).toBeNull()
    expect(titlesIn('Past')).toEqual(['October 2026', 'August 2026'])
    expect(screen.getByRole('button', { name: 'Show older reports' })).toHaveFocus()
  })

  it('filters by state and title, keeps the view in the address and offers a way back', async () => {
    page([open('o1', 50, 'Media slow'), done('d1', 80)])
    renderAt('/reports')
    const user = userEvent.setup()
    await screen.findByRole('link', { name: 'Media slow' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'resolved')
    expect(screen.queryByRole('region', { name: 'Active' })).toBeNull()
    expect(titlesIn('Past', 4)).toEqual(['Done d1'])
    await user.type(screen.getByRole('searchbox', { name: 'Search titles' }), 'media')
    expect(window.location.search).toBe('?state=resolved&search=media')
    expect(screen.getByRole('searchbox', { name: 'Search titles' })).toHaveFocus()
    expect(screen.getByText(/^No reports match these filters since October 2026\./)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(window.location.search).toBe('')
    expect(screen.getByRole('link', { name: 'Media slow' })).toBeVisible()
  })

  it('reads a shared view and ignores what it cannot read, such as an old page number', async () => {
    page([open('o1', 50), done('d1', 80)])
    renderAt('/reports?page=abc&state=unresolved&months=-1')
    expect(await screen.findByRole('link', { name: 'Open o1' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Done d1' })).toBeNull()
    expect(fetched()).toEqual(['/api/v1/reports?page=1'])
  })

  it('shows the feed links only when feeds are on', async () => {
    page([])
    renderAt('/reports')
    await screen.findByText('No reports have been published.')
    expect(screen.getByRole('main')).toHaveTextContent('Subscribe: Atom · RSS · JSON Feed')
  })

  it('renders hostile titles and text as plain text', async () => {
    const hostile = wire(
      report({
        id: 'x/../admin',
        title: '<img src=x onerror="alert(1)">',
        updates: [
          { stage: 'investigating', at: at(44), message: '<script>alert(1)</script>\nline 2' },
        ],
        endpoints: [{ key: 'media', name: '<b>Media</b>', impact: 'major' }],
      }),
    )
    page([hostile])
    renderAt('/reports')
    const link = await screen.findByRole('link', { name: '<img src=x onerror="alert(1)">' })
    expect(link).toHaveAttribute('href', '/reports/x%2F..%2Fadmin')
    const main = screen.getByRole('main')
    expect(main.querySelector('img, script, b')).toBeNull()
    expect(main).toHaveTextContent('<b>Media</b>: Down')
    const text = screen.getByText(/<script>alert\(1\)<\/script>/)
    expect(text.textContent).toBe('<script>alert(1)</script>\nline 2')
    // jsdom applies no module CSS, so check the class and what the class does.
    expect(text).toHaveClass('text')
    expect(commonCss).toMatch(/\.text \{[^}]*white-space: pre-wrap;/)
  })
})
