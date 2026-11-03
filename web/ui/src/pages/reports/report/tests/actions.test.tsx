// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { at, report } from '../../../../test/fixtures'
import {
  answer,
  answerEvents,
  mediaFailed,
  renderAt,
  resolved,
  startServer,
  stopServer,
  wire,
} from '../../testing'

beforeEach(startServer)
afterEach(stopServer)

describe('report page actions', () => {
  beforeEach(() => {
    answer('/api/v1/reports/r1', wire(resolved))
    answerEvents('media', mediaFailed)
  })

  it('copies plain text for a ticket', async () => {
    const user = userEvent.setup()
    renderAt('/reports/r1')
    await screen.findByText(/Checks failed for 22 minutes in all\./)
    await user.click(screen.getByRole('button', { name: 'Copy for a ticket' }))
    expect(await navigator.clipboard.readText()).toBe(
      [
        'Pralvo status at 2 Nov 2026, 14:30 UTC:',
        'Report: “Images were slow to load” (Resolved, 14:20 UTC).',
        'Resolved on 2 Nov 2026 at 14:20 UTC, 36 minutes after it was published. Checks failed for 22 minutes in all.',
        'Affected: Media (Degraded).',
        `${window.location.origin}/reports/r1`,
      ].join('\n'),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Copied the text for a ticket.')
  })

  it('shows the text to select when the browser refuses to copy', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    renderAt('/reports/r1')
    await screen.findByText(/Checks failed for 22 minutes in all\./)
    await user.click(screen.getByRole('button', { name: 'Copy for a ticket' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your browser did not allow copying. Select the text below.',
    )
    const box = screen.getByRole('textbox', { name: 'Text for a ticket' })
    expect((box as HTMLTextAreaElement).value).toContain('Report: “Images were slow to load”')
    expect(box).toHaveAttribute('readonly')
  })

  it('links to the status page at the moment the report was first published', async () => {
    renderAt('/reports/r1')
    const link = await screen.findByRole('link', {
      name: 'See the status page at 2 Nov 2026, 13:44 UTC',
    })
    expect(link).toHaveAttribute('href', `${window.location.origin}/?at=2026-11-02T13:44Z`)
  })

  it('reaches the copy button and the time-travel link by keyboard', async () => {
    const user = userEvent.setup()
    renderAt('/reports/r1')
    const panel = await screen.findByRole('region', { name: 'Stage' })
    within(panel).getByRole('button', { name: 'Copy for a ticket' }).focus()
    await user.tab()
    expect(within(panel).getByRole('link', { name: /See the status page at/ })).toHaveFocus()
  })

  it('moves focus to the report title after following a link from the list', async () => {
    answer('/api/v1/reports?page=1', { reports: [wire(resolved)], page: 1, more: false })
    const user = userEvent.setup()
    renderAt('/reports')
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).not.toHaveFocus()
    await user.click(await screen.findByRole('link', { name: 'Images were slow to load' }))
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Images were slow to load',
    })
    expect(heading).toHaveFocus()
    expect(document.title).toBe('Images were slow to load · Reports · Pralvo status')
  })
})

describe('hostile report text', () => {
  it('renders titles, messages and service names as text, keeping line breaks', async () => {
    const hostile = report({
      id: 'r1',
      title: '<img src=x onerror="alert(1)">',
      updates: [
        {
          stage: 'investigating',
          at: at(44),
          message: '<script>alert(1)</script>\n<a href="javascript:alert(1)">click</a>',
        },
      ],
      endpoints: [{ key: '../admin', name: '<b>Media</b>', impact: 'partial' }],
    })
    answer('/api/v1/reports/r1', wire(hostile))
    answer('/api/v1/endpoints/..%2Fadmin/statuses?page=1&pageSize=1', 'nope', 404)
    renderAt('/reports/r1')
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: '<img src=x onerror="alert(1)">',
    })
    expect(heading).toBeVisible()
    const main = screen.getByRole('main')
    expect(main.querySelector('img, script, b')).toBeNull()
    expect(main.querySelectorAll('a[href^="javascript"]')).toHaveLength(0)
    const message = within(main).getByText(/<script>alert\(1\)<\/script>/)
    expect(message.textContent).toContain('<script>alert(1)</script>\n<a href=')
    expect(message).toHaveClass('text')
    const service = within(main).getByRole('link', { name: '<b>Media</b>' })
    expect(service).toHaveAttribute('href', '/endpoints/..%2Fadmin')
    expect(document.title).toBe('<img src=x onerror="alert(1)"> · Reports · Pralvo status')
  })
})
