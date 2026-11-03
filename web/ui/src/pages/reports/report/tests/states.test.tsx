// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { event, report } from '../../../../test/fixtures'
import {
  answer,
  answerEvents,
  fetched,
  mediaFailed,
  renderAt,
  resolved,
  startServer,
  stopServer,
  wire,
} from '../../testing'

beforeEach(startServer)
afterEach(stopServer)

function story(): string[] {
  const section = screen.getByRole('region', { name: 'The story' })
  return within(section)
    .getAllByRole('listitem')
    .map((item) => item.textContent)
}

function glance(): string[] {
  const section = screen.getByRole('region', { name: 'At a glance' })
  return within(section)
    .getAllByRole('listitem')
    .map((item) => item.textContent)
}

describe('a resolved report with failed checks', () => {
  beforeEach(() => {
    answer('/api/v1/reports/r1', wire(resolved))
    answerEvents('media', mediaFailed)
  })

  it('shows breadcrumbs, the title, the resolved sentence and the page title', async () => {
    renderAt('/reports/r1')
    expect(
      await screen.findByText(
        'Resolved on 2 Nov 2026 at 14:20 UTC, 36 minutes after it was published. Checks failed for 22 minutes in all.',
      ),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Images were slow to load' }),
    ).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumbs' })
    expect(within(crumbs).getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/')
    expect(within(crumbs).getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/reports',
    )
    expect(within(crumbs).getByText('Images were slow to load')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('region', { name: 'Stage' })).toHaveTextContent('Resolved')
    expect(document.title).toBe('Images were slow to load · Reports · Pralvo status')
  })

  it('writes the ribbon in words and draws it for sighted readers only', async () => {
    renderAt('/reports/r1')
    await screen.findByText(/Checks failed for 22 minutes in all\./)
    expect(glance()).toEqual([
      'Failed checks (measured): 13:40 to 14:02 UTC, 22 minutes.',
      'Report open: 13:44 to 14:20 UTC. Stages: 1 Investigating 13:44, 2 Identified 13:51, 3 Monitoring 13:58, 4 Resolved 14:20.',
      'Times in UTC.',
    ])
    const svg = screen.getByRole('region', { name: 'At a glance' }).querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg?.querySelectorAll('rect')).toHaveLength(2)
    expect(svg).toHaveTextContent(/Failed checks.*Report open.*1.*2.*3.*4.*13:30.*14:30/)
  })

  it('tells the story oldest first with a source on every item and the response speed', async () => {
    renderAt('/reports/r1')
    await screen.findByText(/Checks failed for 22 minutes in all\./)
    expect(story()).toEqual([
      'Measured 13:40 UTCChecks for Media began failing.',
      'Reported 13:44 UTCInvestigating: “Some images are loading slowly.” Published 4 minutes after checks first failed.',
      'Reported 13:51 UTCIdentified: “Images are answering slowly.”',
      'Reported 13:58 UTCMonitoring: “Images load normally again.”',
      'Measured 14:02 UTCChecks for Media passed again.',
      'Reported 14:20 UTCResolved: “Images have loaded normally for 20 minutes.”',
    ])
  })

  it('lists the affected services with impact words and links', async () => {
    renderAt('/reports/r1')
    const section = await screen.findByRole('region', { name: 'Affected services' })
    expect(within(section).getByRole('link', { name: 'Media' })).toHaveAttribute(
      'href',
      '/endpoints/media',
    )
    expect(section).toHaveTextContent('Media: Degraded')
    expect(screen.getByRole('link', { name: 'All reports' })).toHaveAttribute('href', '/reports')
  })
})

describe('an ongoing report', () => {
  it('words the open stage and runs the report to now when no checks failed', async () => {
    answer('/api/v1/reports/r1', wire(report()))
    answerEvents('media', [event('START', -500)])
    renderAt('/reports/r1')
    expect(
      await screen.findByText('Investigating. We are looking into this problem.'),
    ).toBeVisible()
    await screen.findByText('No failed checks measured')
    expect(glance()).toEqual([
      'Report open: 13:44 to now. Stages: 1 Investigating 13:44.',
      'Times in UTC.',
    ])
    expect(screen.queryByText(/after checks first failed/)).toBeNull()
    expect(story()).toEqual(['Reported 13:44 UTCInvestigating: “We are looking into it.”'])
  })

  it('shows a failure still open and how soon the report followed it', async () => {
    answer('/api/v1/reports/r1', wire(report({ stage: 'identified' })))
    answerEvents('media', [event('START', -500), event('UNHEALTHY', 40)])
    renderAt('/reports/r1')
    expect(await screen.findByText('Identified. The cause is known.')).toBeVisible()
    await screen.findByText(/Published 4 minutes after checks first failed\./)
    expect(glance()[0]).toBe('Failed checks (measured): 13:40 to now, 50 minutes.')
  })

  it('shows the report updates alone when the check events cannot load', async () => {
    answer('/api/v1/reports/r1', wire(resolved))
    answer('/api/v1/endpoints/media/statuses?page=1&pageSize=1', 'down', 500)
    renderAt('/reports/r1')
    expect(
      await screen.findByText(/Check events could not be loaded, so only the report updates/),
    ).toBeVisible()
    expect(
      screen.getByText('Resolved on 2 Nov 2026 at 14:20 UTC, 36 minutes after it was published.'),
    ).toBeVisible()
    expect(glance()[0]).toBe('Failed checks (measured): the check events could not be loaded.')
    expect(story()).toHaveLength(4)
  })
})

describe('a report that cannot be shown', () => {
  it('says a missing report or draft does not exist', async () => {
    answer('/api/v1/reports/draft-1', 'not found', 404)
    renderAt('/reports/draft-1')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This report does not exist.' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'All reports' })).toHaveAttribute('href', '/reports')
    expect(document.title).toBe('Not found · Reports · Pralvo status')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumbs' })).toBeNull()
    expect(fetched().filter((url) => url === '/api/v1/reports/draft-1')).toHaveLength(1)
  })

  it('says the report could not be loaded and tries again on request', async () => {
    answer('/api/v1/reports/r1', 'down', 500)
    answerEvents('media', mediaFailed)
    renderAt('/reports/r1')
    expect(
      await screen.findByText(
        'This report could not be loaded. Service checks on the status page are not affected.',
      ),
    ).toBeVisible()
    answer('/api/v1/reports/r1', wire(resolved))
    const [retry] = screen.getAllByRole('button', { name: 'Try again' })
    await userEvent.setup().click(retry as HTMLElement)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Images were slow to load' }),
    ).toBeVisible()
  })

  it('shows a loading state first', () => {
    answer('/api/v1/reports/r1', wire(resolved))
    renderAt('/reports/r1')
    expect(screen.getByText('Loading the report…')).toBeVisible()
  })
})
