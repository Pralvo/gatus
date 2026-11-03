// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { results } from '../../test/fixtures'
import { cleanUpAdmin, renderAdmin } from '../test/render'
import { adminReport, fakeServer } from '../test/server'

afterEach(cleanUpAdmin)

const statuses = [
  { key: 'website', name: 'Website', group: 'Public site', results: results(6, { last: 60 }) },
  { key: 'media', name: 'Media', group: 'Supporting services', results: results(6, { last: 60 }) },
]

const draft = adminReport({ id: 'd1', title: 'Some images fail to load' })
const published = adminReport({
  id: 'p1',
  title: 'Images were slow to load',
  stage: 'resolved',
  published_at: '2026-11-02T13:30:00Z',
})

describe('reports list', () => {
  it('lists every report with its stage, visibility and time', async () => {
    fakeServer({ reports: [draft, published] })
    renderAdmin('/')
    const link = await screen.findByRole('link', { name: 'Some images fail to load' })
    expect(link).toHaveAttribute('href', '/admin/reports/d1')
    const rows = screen.getAllByRole('row')
    expect(within(rows[1] as HTMLElement).getByText('Investigating')).toBeVisible()
    expect(within(rows[1] as HTMLElement).getByText('Draft')).toBeVisible()
    expect(within(rows[2] as HTMLElement).getByText('Published')).toBeVisible()
    expect(within(rows[1] as HTMLElement).getByText('13:44 UTC')).toHaveAttribute(
      'datetime',
      '2026-11-02T13:44:00.000Z',
    )
    expect(document.title).toBe('Reports · Admin · Pralvo status')
  })

  it('filters to drafts or published reports', async () => {
    fakeServer({ reports: [draft, published] })
    const { user } = renderAdmin('/')
    await screen.findByRole('link', { name: 'Some images fail to load' })
    await user.click(screen.getByRole('button', { name: 'Drafts' }))
    expect(screen.queryByRole('link', { name: 'Images were slow to load' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Some images fail to load' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Published' }))
    expect(screen.queryByRole('link', { name: 'Some images fail to load' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Images were slow to load' })).toBeVisible()
  })

  it('says when there are none, per filter', async () => {
    fakeServer({ reports: [draft] })
    const { user } = renderAdmin('/')
    await screen.findByRole('link', { name: 'Some images fail to load' })
    await user.click(screen.getByRole('button', { name: 'Published' }))
    expect(screen.getByText('No published reports.')).toBeVisible()
  })

  it('shows loading, then a storage failure with a way to try again', async () => {
    const server = fakeServer({ reports: [] })
    server.failNext(503, { error: 'unavailable' })
    const { user } = renderAdmin('/')
    expect(screen.getByText('Loading reports…')).toBeVisible()
    expect(await screen.findByText('Storage is unavailable. Try again shortly.')).toBeVisible()
    // Banner renders its actions twice, one set for narrow layouts, hidden by CSS.
    const [retry] = screen.getAllByRole('button', { name: 'Try again' })
    await user.click(retry as HTMLElement)
    expect(await screen.findByText('No reports yet.')).toBeVisible()
  })

  it('says when the incidents plugin is not running', async () => {
    const server = fakeServer()
    server.failNext(404)
    renderAdmin('/')
    expect(
      await screen.findByText('The incidents plugin is not running on this server.'),
    ).toBeVisible()
  })
})

describe('new report', () => {
  it('creates a draft with its stage, message and affected services, then opens it', async () => {
    const server = fakeServer({ reports: [], statuses })
    const { user } = renderAdmin('/')
    await user.click(await screen.findByRole('button', { name: 'New report' }))
    const dialog = screen.getByRole('dialog', { name: 'New report' })
    await user.type(within(dialog).getByLabelText(/Title/), 'Images fail')
    await user.selectOptions(within(dialog).getByLabelText('Stage'), 'Identified')
    await user.type(within(dialog).getByLabelText(/First update/), 'We found the cause.')
    await user.selectOptions(await within(dialog).findByLabelText(/Media/), 'Partial outage')
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Images fail' })).toHaveFocus()
    expect(screen.getByText('Draft created. Check the preview, then publish it.')).toBeVisible()
    const created = server.adminCalls().find((call) => call.method === 'POST')
    expect(created?.body).toEqual({
      title: 'Images fail',
      stage: 'identified',
      message: 'We found the cause.',
      endpoints: [{ key: 'media', impact: 'partial' }],
      published: false,
    })
  })

  it('asks for a title and a first update before sending anything', async () => {
    const server = fakeServer({ reports: [] })
    const { user } = renderAdmin('/')
    await user.click(await screen.findByRole('button', { name: 'New report' }))
    await user.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(screen.getByText('Enter a title.')).toBeVisible()
    expect(screen.getByText('Write the first update.')).toBeVisible()
    expect(server.adminCalls().filter((call) => call.method === 'POST')).toEqual([])
  })

  it('closes on Cancel and returns focus to "New report"', async () => {
    fakeServer({ reports: [] })
    const { user } = renderAdmin('/')
    const opener = await screen.findByRole('button', { name: 'New report' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })
})
