// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { at } from '../../test/fixtures'
import { cleanUpAdmin, renderAdmin } from '../test/render'
import { goodToken } from '../test/server'

afterEach(cleanUpAdmin)

const reference = 'PR-ABCDEFGHIJKLMNOP'
const report = {
  reference,
  receivedAt: new Date(at(50)).toISOString(),
  service: 'core_api',
  page: '/endpoints/core_api',
  description: 'The API answers 502 from here',
  details: '',
  country: 'IN',
  browser: 'Firefox',
  browserMajor: 143,
  os: 'Linux',
}

interface Call {
  method: string
  path: string
  authorization: string | null
}

function serve(): Call[] {
  const calls: Call[] = []
  let stored = [report]
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      calls.push({ method, path: url, authorization: headers.get('Authorization') })
      const json = (status: number, body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      if (url === '/api/v1/admin/problem-reports/summary') {
        return json(200, {
          total: stored.length,
          countries: [{ key: 'IN', count: stored.length }],
          services: [{ key: '', count: stored.length }],
        })
      }
      if (url.startsWith('/api/v1/admin/problem-reports?')) {
        return json(200, { reports: stored, more: false })
      }
      if (url === `/api/v1/admin/problem-reports/${reference}`) {
        if (method === 'DELETE') {
          stored = []
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return stored.length > 0 ? json(200, report) : json(404, { error: 'not_found' })
      }
      return json(404, {})
    }),
  )
  return calls
}

describe('problem reports', () => {
  it('shows the last hour and the list, with the token on every call', async () => {
    const calls = serve()
    renderAdmin('/problems')
    expect(await screen.findByRole('heading', { level: 1, name: 'Problem reports' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'Last hour: 1 reports' })).toBeVisible()
    expect(screen.getByText('None chosen:')).toBeVisible()
    const row = (await screen.findByText(report.description)).closest('tr') as HTMLElement
    expect(within(row).getByText('IN')).toBeVisible()
    expect(within(row).getByText('Firefox 143 Linux')).toBeVisible()
    expect(calls.every((call) => call.authorization === `Bearer ${goodToken}`)).toBe(true)
    expect(screen.getAllByRole('link', { name: 'Problem reports' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('finds a report by reference and deletes it after asking', async () => {
    const calls = serve()
    const { user } = renderAdmin('/problems')
    await user.type(await screen.findByRole('textbox', { name: 'Reference' }), reference)
    await user.click(screen.getByRole('button', { name: 'Find' }))
    const found = within(await screen.findByRole('status', { name: 'Search result' }))
    const [button] = await found.findAllByRole('button', { name: `Delete ${reference}` })
    await user.click(button as HTMLElement)
    const dialog = await screen.findByRole('alertdialog', { name: `Delete report ${reference}?` })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(`Report ${reference} deleted.`)).toBeVisible()
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
      {
        method: 'DELETE',
        path: `/api/v1/admin/problem-reports/${reference}`,
        authorization: `Bearer ${goodToken}`,
      },
    ])
  })

  it('deletes nothing when the question is cancelled', async () => {
    const calls = serve()
    const { user } = renderAdmin('/problems')
    const [button] = await screen.findAllByRole('button', { name: `Delete ${reference}` })
    await user.click(button as HTMLElement)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0)
  })
})
