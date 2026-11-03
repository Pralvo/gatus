// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pralvoConfig, pralvoEstate, renderHome, requested, serve, setNow } from './harness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
})

const pages = ['https://pralvo.com/', 'https://pralvo.com/blog/', 'https://media.pralvo.com/']

async function check(failing: Record<string, number[]>, unreachable: string[]) {
  setNow()
  const estate = pralvoEstate(failing)
  estate.unreachable = new Set(unreachable)
  const fetchMock = serve(estate)
  const { user } = renderHome()
  await screen.findByRole('heading', { level: 1, name: (name) => name !== 'Loading status' })
  expect(requested(fetchMock).filter((path) => pages.includes(path))).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Is it just me?' }))
  const result = await screen.findByRole('region', { name: 'Is it just me?' })
  return { result, fetchMock }
}

function rows(result: HTMLElement): string[][] {
  return within(result)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''))
}

describe('Is it just me?', () => {
  it('runs only on click, opaquely, and sends nothing anywhere', async () => {
    const { result, fetchMock } = await check({}, [])
    const probes = fetchMock.mock.calls.filter(([input]) => String(input).startsWith('https://'))
    expect(probes).toHaveLength(3)
    for (const [input, init] of probes) {
      expect(String(input)).toMatch(/\?check=\w+$/)
      expect(init).toMatchObject({
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      expect(init).not.toHaveProperty('body')
    }
    expect(result).toHaveTextContent(
      'Your browser contacted these pages directly. It can tell whether they answered, not whether they worked. The result is not sent to Pralvo.',
    )
  })

  it('all reached, monitor passing', async () => {
    const { result } = await check({}, [])
    expect(within(result).getByRole('status')).toHaveTextContent(
      'Your browser reached all three pages. If something still fails for you, the problem is likely on your side: a browser extension, network filter or VPN.',
    )
    expect(rows(result)).toEqual([
      ['Website', expect.stringMatching(/^Reached in \d+ ms$/), 'Website: passing'],
      ['Blog', expect.stringMatching(/^Reached in \d+ ms$/), 'Blog: passing'],
      ['The image store', expect.stringMatching(/^Reached in \d+ ms$/), 'Not monitored'],
    ])
  })

  it('you fail, monitor passes', async () => {
    const { result } = await check({}, ['https://pralvo.com/blog/'])
    expect(within(result).getByRole('status')).toHaveTextContent(
      'Our monitor reaches these pages, but your browser could not. The problem is likely between you and Pralvo: your network, a firewall or a VPN.',
    )
    expect(rows(result)[1]).toEqual(['Blog', 'Not reached', 'Blog: passing'])
  })

  it('you pass, monitor fails', async () => {
    const { result } = await check({ website: [60] }, [])
    expect(within(result).getByRole('status')).toHaveTextContent(
      'Your browser reached these pages, but our monitor could not. It may affect some places and not others.',
    )
    expect(rows(result)[0]?.[2]).toBe('Website: failing')
  })

  it('both fail', async () => {
    const { result } = await check({ website: [60] }, ['https://pralvo.com/'])
    expect(within(result).getByRole('status')).toHaveTextContent(
      "It's not just you. Our monitor cannot reach these pages either.",
    )
  })

  it('offers the check first, and the browser tip, when a probed service fails', async () => {
    setNow()
    serve(pralvoEstate({ website: [55, 60] }))
    renderHome()
    expect(
      await screen.findByText(
        'It has failed its last 2 checks, since 13:55 UTC: answered with error 503; it needs a code below 500. Try it from your browser.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Is it just me?' }).dataset.variant).toBe('primary')
  })

  it('is hidden when no browser checks are configured', async () => {
    setNow()
    serve(pralvoEstate())
    renderHome('/', { ...pralvoConfig, browserChecks: [] })
    await screen.findByRole('heading', { level: 1, name: 'Everything is working' })
    expect(screen.queryByRole('button', { name: 'Is it just me?' })).toBeNull()
    expect(screen.getByRole('region', { name: 'About this page' })).not.toHaveTextContent(
      'browser check',
    )
  })
})
