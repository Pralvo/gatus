// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { defaultPageConfig, type PageConfig } from '../config/pageConfig'

import { App } from './App'
import { readThemeChoice, saveThemeChoice } from './theme'

const pralvo: PageConfig = {
  ...defaultPageConfig,
  header: 'Pralvo status',
  logo: '/pralvo-mark.svg',
  logoDark: '/pralvo-mark-dark.svg',
  footerLinks: [
    { name: 'Pralvo', link: 'https://pralvo.com/' },
    { name: 'Source (Apache 2.0)', link: 'https://github.com/Pralvo/gatus' },
  ],
  sourceLink: 'https://github.com/Pralvo/gatus',
  feeds: true,
}

afterEach(() => {
  saveThemeChoice('system')
  window.history.pushState({}, '', '/')
})

describe('App frame', () => {
  it('shows the configured name, logo and footer', () => {
    window.history.pushState({}, '', '/nowhere')
    render(<App config={pralvo} />)
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Pralvo status' })).toHaveAttribute('href', '/')
    expect(banner.querySelector('img')).toHaveAttribute('src', '/pralvo-mark.svg')
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('Pralvo·Source (Apache 2.0)·Powered by Gatus')
    expect(within(footer).getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/Pralvo/gatus',
    )
    expect(within(footer).getByRole('link', { name: 'JSON Feed' })).toHaveAttribute(
      'href',
      '/feed/feed.json',
    )
  })

  it('hides the feeds line when the feeds plugin is off', () => {
    render(<App config={{ ...pralvo, feeds: false }} />)
    expect(screen.queryByText(/Subscribe/)).toBeNull()
  })

  it('shows a not-found page with a way back for unknown addresses', () => {
    window.history.pushState({}, '', '/no/such/page')
    render(<App config={pralvo} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'There is nothing at this address' }),
    ).toBeVisible()
    expect(document.title).toBe('Not found · Pralvo status')
  })

  it('remembers a theme chosen in the header and uses the dark logo for it', async () => {
    const user = userEvent.setup()
    render(<App config={pralvo} />)
    await user.click(screen.getByRole('button', { name: 'Theme: system' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))
    expect(readThemeChoice()).toBe('dark')
    expect(screen.getByRole('button', { name: 'Theme: dark' })).toBeVisible()
    expect(screen.getByRole('banner').querySelector('img')).toHaveAttribute(
      'src',
      '/pralvo-mark-dark.svg',
    )
  })
})
