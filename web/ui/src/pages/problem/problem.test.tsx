// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../app/App'
import { defaultPageConfig } from '../../config/pageConfig'

const settingsUrl = '/api/v1/problem-reports/settings'
const settings = {
  enabled: true,
  privacyUrl: 'https://example.com/privacy',
  contact: 'privacy@example.com',
  retentionDays: 90,
}

interface Sent {
  url: string
  method: string
  body: unknown
}

function serve({ on = true, postStatus = 201 } = {}): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      sent.push({
        url,
        method,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      const json = (status: number, body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      if (url === settingsUrl) {
        return on ? json(200, settings) : json(404, {})
      }
      if (url.startsWith('/api/v1/endpoints/statuses')) {
        return json(200, [{ key: 'core_api', name: 'API', group: 'core', results: [] }])
      }
      if (method === 'POST') {
        return postStatus === 201
          ? json(201, { reference: 'PR-ABCDEFGHIJKLMNOP' })
          : json(postStatus, { error: 'rate_limited', message: 'too many' })
      }
      return json(404, {})
    }),
  )
  return sent
}

function open(path: string) {
  window.history.pushState({}, '', path)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = userEvent.setup()
  render(
    <App config={{ ...defaultPageConfig, header: 'Pralvo status' }} queryClient={queryClient} />,
  )
  return user
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('report a problem', () => {
  it('shows no link and no form when the server has the form off', async () => {
    serve({ on: false })
    open('/report-a-problem')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Reporting a problem is not available here',
      }),
    ).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Report a problem' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull()
  })

  it('links from the footer when the form is on', async () => {
    serve()
    open('/reports')
    const footer = screen.getByRole('contentinfo')
    const link = await within(footer).findByRole('link', { name: 'Report a problem' })
    expect(link).toHaveAttribute('href', '/report-a-problem?from=%2Freports')
  })

  it('shows the notice before the form, with its links and retention', async () => {
    serve()
    open('/report-a-problem')
    const notice = await screen.findByRole('region', { name: 'Before you send' })
    expect(within(notice).getByText(/90 days, then it is deleted/)).toBeVisible()
    expect(within(notice).getByText(/your IP address/)).toBeVisible()
    expect(within(notice).getByRole('link', { name: 'privacy notice' })).toHaveAttribute(
      'href',
      settings.privacyUrl,
    )
    expect(within(notice).getByRole('link', { name: 'contact us' })).toHaveAttribute(
      'href',
      'mailto:privacy@example.com',
    )
  })

  it('names a short description as the error, focuses it and sends nothing', async () => {
    const sent = serve()
    const user = open('/report-a-problem')
    const field = await screen.findByRole('textbox', { name: /What went wrong/ })
    await user.type(field, 'broken')
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(/at least 10 characters/)
    expect(sent.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('sends only the form fields, keeps nothing in the browser, and gives the reference', async () => {
    const sent = serve()
    const user = open('/report-a-problem?service=core_api&from=/endpoints/core_api')
    const field = await screen.findByRole('textbox', { name: /What went wrong/ })
    expect(screen.getByRole('combobox', { name: 'Service (optional)' })).toHaveValue('core_api')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await user.type(field, 'The API answers 502 from here')
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    const heading = await screen.findByRole('heading', { name: 'Thank you. Your report was sent.' })
    expect(heading).toHaveFocus()
    expect(screen.getByText('PR-ABCDEFGHIJKLMNOP')).toBeVisible()
    expect(sent.filter((call) => call.method === 'POST')).toEqual([
      {
        url: '/api/v1/problem-reports',
        method: 'POST',
        body: {
          description: 'The API answers 502 from here',
          details: '',
          service: 'core_api',
          page: '/endpoints/core_api',
          website: '',
        },
      },
    ])
    expect(setItem).not.toHaveBeenCalled()
    expect(document.cookie).toBe('')
  })

  it('announces a refusal', async () => {
    serve({ postStatus: 429 })
    const user = open('/report-a-problem')
    await user.type(
      await screen.findByRole('textbox', { name: /What went wrong/ }),
      'The API answers 502 from here',
    )
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many reports came from your connection',
    )
  })
})
