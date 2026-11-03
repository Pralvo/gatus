// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { results } from '../../../test/fixtures'
import { cleanUpAdmin, renderAdmin } from '../../test/render'
import { adminReport, fakeServer, type FakeOptions } from '../../test/server'

afterEach(cleanUpAdmin)

function status(key: string, name: string, failing: number[] = []) {
  return { key, name, group: 'Supporting services', results: results(6, { last: 60, failing }) }
}

const passing = [status('website', 'Website'), status('media', 'Media')]
const mediaFailing = [status('website', 'Website'), status('media', 'Media', [50, 55, 60])]

async function openEditor(options: FakeOptions = {}) {
  const server = fakeServer({ statuses: passing, ...options })
  const view = renderAdmin('/reports/a1b2')
  await screen.findByRole('heading', { level: 1, name: 'Some images fail to load' })
  return { server, ...view }
}

function preview() {
  return screen.getByRole('complementary', { name: 'What visitors will see after publishing' })
}

describe('report editor', () => {
  it('shows the report, its updates and the public preview', async () => {
    await openEditor()
    expect(screen.getByText('Draft.')).toBeVisible()
    expect(screen.getByText('We are looking into it.')).toBeVisible()
    expect(await within(preview()).findByText('We are looking into a problem')).toBeVisible()
    expect(document.title).toBe('Some images fail to load · Admin · Pralvo status')
  })

  it('changes the preview headline as impacts change, before saving', async () => {
    const { user } = await openEditor()
    const media = await screen.findByLabelText('Media')
    await user.selectOptions(media, 'Partial outage')
    expect(within(preview()).getByText('Media is partly down')).toBeVisible()
    expect(within(preview()).getByText('Partly down')).toBeVisible()
    await user.selectOptions(media, 'Major outage')
    expect(within(preview()).getByText('Media is down')).toBeVisible()
    await user.selectOptions(media, 'Degraded')
    expect(within(preview()).getByText('Media is degraded')).toBeVisible()
    await user.selectOptions(media, 'Not affected')
    expect(within(preview()).getByText('We are looking into a problem')).toBeVisible()
  })

  it('saves only what changed, and says when nothing did', async () => {
    const { server, user } = await openEditor()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Nothing changed.')).toBeVisible()
    expect(server.adminCalls().filter((call) => call.method === 'PATCH')).toEqual([])
    await user.selectOptions(await screen.findByLabelText('Website'), 'Major outage')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Saved.')).toBeVisible()
    const patch = server.adminCalls().find((call) => call.method === 'PATCH')
    expect(patch?.body).toEqual({ endpoints: [{ key: 'website', impact: 'major' }] })
  })

  it('posts an update with its stage, and asks for a message first', async () => {
    const { server, user } = await openEditor()
    const form = screen.getByRole('heading', { name: 'Post an update' }).parentElement
    const scope = within(form as HTMLElement)
    await user.click(scope.getByRole('button', { name: 'Post update' }))
    expect(scope.getByText('Write a message first.')).toBeVisible()
    await user.selectOptions(scope.getByLabelText('Stage'), 'Monitoring')
    await user.type(scope.getByLabelText(/Message/), 'A fix is out.')
    await user.click(scope.getByRole('button', { name: 'Post update' }))
    expect(await screen.findByText('Update posted.')).toBeVisible()
    expect(screen.getByText('A fix is out.')).toBeVisible()
    expect(server.adminCalls().find((call) => call.method === 'POST')?.body).toEqual({
      stage: 'monitoring',
      message: 'A fix is out.',
    })
  })

  it('suggests failing services from the checks and adds one as a partial outage', async () => {
    const { user } = await openEditor({ statuses: mediaFailing })
    expect(
      await screen.findByText('Media has failed its last 3 checks, since 13:50 UTC.'),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add Media as affected' }))
    expect(screen.getByLabelText('Media')).toHaveValue('partial')
    expect(screen.getByLabelText('Media')).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Add Media as affected' })).toBeNull()
    expect(within(preview()).getByText('Media failed its latest check')).toBeVisible()
  })
})

describe('publication', () => {
  it('publishes only after the dialog is confirmed, saving unsaved choices first', async () => {
    const { server, user } = await openEditor()
    await user.selectOptions(await screen.findByLabelText('Media'), 'Partial outage')
    await user.click(screen.getByRole('button', { name: 'Publish…' }))
    const dialog = screen.getByRole('dialog', { name: 'Publish this report?' })
    expect(dialog).toHaveTextContent('Your unsaved changes')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(server.adminCalls().filter((call) => call.method !== 'GET')).toEqual([])
    expect(screen.getByRole('button', { name: 'Publish…' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Publish…' }))
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Published.')).toBeVisible()
    const writes = server.adminCalls().filter((call) => call.method !== 'GET')
    expect(writes.map((call) => [call.method, call.body])).toEqual([
      ['PATCH', { endpoints: [{ key: 'media', impact: 'partial' }] }],
      ['PUT', { published: true }],
    ])
    expect(screen.getByRole('link', { name: 'View the public page' })).toHaveAttribute(
      'href',
      '/reports/a1b2',
    )
  })

  it('returns a published report to draft after the dialog', async () => {
    const { server, user } = await openEditor({
      reports: [adminReport({ published_at: '2026-11-02T13:45:00Z' })],
    })
    expect(screen.getByText(/2 Nov 2026, 13:45 UTC/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Return to draft…' }))
    await user.click(screen.getByRole('button', { name: 'Return to draft' }))
    expect(await screen.findByText('Returned to draft.')).toBeVisible()
    expect(server.adminCalls().find((call) => call.method === 'PUT')?.body).toEqual({
      published: false,
    })
    expect(screen.getByText('Draft.')).toBeVisible()
  })

  it('says when the report does not exist', async () => {
    fakeServer({ reports: [] })
    renderAdmin('/reports/missing')
    expect(await screen.findByText('That record does not exist.')).toBeVisible()
  })
})
