// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanUpAdmin, renderAdmin } from '../test/render'
import { adminIncident, fakeServer } from '../test/server'

afterEach(cleanUpAdmin)

describe('incidents list', () => {
  it('lists incidents with severity, state and when they opened', async () => {
    fakeServer({
      incidents: [
        adminIncident(),
        adminIncident({ id: 'i2', title: 'Slow blog', state: 'resolved', severity: 'minor' }),
      ],
    })
    renderAdmin('/incidents')
    const link = await screen.findByRole('link', { name: 'Image store errors' })
    expect(link).toHaveAttribute('href', '/admin/incidents/i1')
    const rows = screen.getAllByRole('row')
    expect(within(rows[1] as HTMLElement).getByText('Major')).toBeVisible()
    expect(within(rows[1] as HTMLElement).getByText('Open')).toBeVisible()
    expect(within(rows[2] as HTMLElement).getByText('Resolved')).toBeVisible()
    expect(document.title).toBe('Incidents · Admin · Pralvo status')
  })

  it('says when there are none', async () => {
    fakeServer({ incidents: [] })
    renderAdmin('/incidents')
    expect(await screen.findByText('No incidents.')).toBeVisible()
  })

  it('moves between sections from the navigation, focusing the new heading', async () => {
    fakeServer()
    const { user } = renderAdmin('/')
    await screen.findByRole('heading', { level: 1, name: 'Reports' })
    const [link] = screen.getAllByRole('link', { name: 'Incidents' })
    await user.click(link as HTMLElement)
    expect(await screen.findByRole('heading', { level: 1, name: 'Incidents' })).toHaveFocus()
    expect(screen.getAllByRole('link', { name: 'Incidents' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('opens a new incident and goes to it', async () => {
    const server = fakeServer({ incidents: [] })
    const { user } = renderAdmin('/incidents')
    await user.click(await screen.findByRole('button', { name: 'New incident' }))
    const dialog = screen.getByRole('dialog', { name: 'New incident' })
    await user.type(within(dialog).getByLabelText(/Title/), 'Database slow')
    await user.selectOptions(within(dialog).getByLabelText('Severity'), 'Critical')
    await user.type(within(dialog).getByLabelText(/Commander/), 'bob')
    await user.click(within(dialog).getByRole('button', { name: 'Open incident' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Database slow' })).toBeVisible()
    expect(screen.getByText('Incident opened.')).toBeVisible()
    expect(server.adminCalls().find((call) => call.method === 'POST')?.body).toEqual({
      title: 'Database slow',
      severity: 'critical',
      commander: 'bob',
    })
  })
})
