// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanUpAdmin, renderAdmin } from '../../test/render'
import { adminIncident, fakeServer } from '../../test/server'

afterEach(cleanUpAdmin)

async function openIncident(state = 'open') {
  const server = fakeServer({ incidents: [adminIncident({ state, commander: 'bob' })] })
  const view = renderAdmin('/incidents/i1')
  await screen.findByRole('heading', { level: 1, name: 'Image store errors' })
  return { server, ...view }
}

function moveButtons(): string[] {
  const section = screen.getByRole('heading', { name: 'Move' }).parentElement as HTMLElement
  return within(section)
    .queryAllByRole('button')
    .map((button) => button.textContent)
}

describe('incident detail', () => {
  it('shows severity, state, who opened it and the timeline', async () => {
    await openIncident()
    expect(screen.getByText('Major', { selector: 'span' })).toBeVisible()
    expect(screen.getByText('Open', { selector: 'span' })).toBeVisible()
    expect(screen.getByText('opened by alice on 2 Nov 2026, 13:50 UTC')).toBeVisible()
    expect(screen.getByText('Commander: bob')).toBeVisible()
    expect(screen.getByText('alice opened the incident')).toBeVisible()
  })

  it.each([
    ['open', ['Move to Mitigated', 'Move to Resolved', 'Move to Cancelled']],
    ['mitigated', ['Move to Open', 'Move to Resolved', 'Move to Cancelled']],
    ['resolved', ['Move to Open', 'Close…']],
    ['cancelled', ['Move to Open', 'Close…']],
  ])('offers only the valid moves from %s', async (state, moves) => {
    await openIncident(state)
    expect(moveButtons()).toEqual(moves)
  })

  it('moves the incident and records it in the timeline', async () => {
    const { server, user } = await openIncident()
    await user.click(screen.getByRole('button', { name: 'Move to Mitigated' }))
    expect(await screen.findByText('Moved to Mitigated.')).toBeVisible()
    expect(screen.getByText('alice moved it from Open to Mitigated')).toBeVisible()
    expect(server.adminCalls().find((call) => call.method === 'POST')?.body).toEqual({
      state: 'mitigated',
    })
    expect(moveButtons()).toEqual(['Move to Open', 'Move to Resolved', 'Move to Cancelled'])
  })

  it('shows the server’s refusal of a move', async () => {
    const { server, user } = await openIncident()
    server.failNext(409, { error: 'invalid_transition' })
    await user.click(screen.getByRole('button', { name: 'Move to Resolved' }))
    expect(
      await screen.findByText('That move is not allowed from the incident’s current state.'),
    ).toBeVisible()
  })

  it('adds a note', async () => {
    const { server, user } = await openIncident()
    await user.type(screen.getByLabelText(/Note/), 'Rolled back the CDN change.')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByText('Note added.')).toBeVisible()
    expect(screen.getByText('Rolled back the CDN change.')).toBeVisible()
    expect(server.adminCalls().find((call) => call.method === 'POST')?.body).toEqual({
      note: 'Rolled back the CDN change.',
    })
  })

  it('saves changed details and says when nothing changed', async () => {
    const { server, user } = await openIncident()
    const details = screen.getByRole('heading', { name: 'Details' }).parentElement as HTMLElement
    await user.click(within(details).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Nothing changed.')).toBeVisible()
    await user.clear(within(details).getByLabelText('Commander'))
    await user.click(within(details).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Saved.')).toBeVisible()
    expect(server.adminCalls().find((call) => call.method === 'PATCH')?.body).toEqual({
      commander: '',
    })
  })
})

describe('closing', () => {
  it('asks in a dialog, and Cancel changes nothing', async () => {
    const { server, user } = await openIncident('resolved')
    const opener = screen.getByRole('button', { name: 'Close…' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Close this incident?' })
    expect(dialog).toHaveTextContent('A closed incident can no longer change')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
    expect(server.adminCalls().filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('closes on confirmation and then offers no changes at all', async () => {
    const { server, user } = await openIncident('cancelled')
    await user.click(screen.getByRole('button', { name: 'Close…' }))
    await user.click(screen.getByRole('button', { name: 'Close incident' }))
    expect(await screen.findAllByText('Closed. This incident can no longer change.')).not.toEqual(
      [],
    )
    expect(server.adminCalls().find((call) => call.method === 'POST')?.body).toEqual({
      state: 'closed',
    })
    expect(moveButtons()).toEqual([])
    expect(screen.getByRole('heading', { name: 'Move' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Details' })).toBeNull()
  })
})
