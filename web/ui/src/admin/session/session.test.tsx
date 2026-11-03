// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cleanUpAdmin, renderAdmin } from '../test/render'
import { fakeServer, goodToken } from '../test/server'

import { tokenKey } from './token'

afterEach(cleanUpAdmin)

async function signIn(token: string) {
  const view = renderAdmin('/', { signedIn: false })
  await view.user.type(screen.getByLabelText(/Token/), token)
  await view.user.click(screen.getByRole('button', { name: 'Sign in' }))
  return view
}

describe('signing in', () => {
  it('asks for the token in a password field', () => {
    fakeServer()
    renderAdmin('/', { signedIn: false })
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    expect(screen.getByLabelText(/Token/)).toHaveAttribute('type', 'password')
    expect(document.title).toBe('Sign in · Admin · Pralvo status')
  })

  it('keeps an accepted token in sessionStorage only and shows the reports', async () => {
    const server = fakeServer()
    const logged = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error')]
    await signIn(goodToken)
    const heading = await screen.findByRole('heading', { level: 1, name: 'Reports' })
    expect(heading).toHaveFocus()
    expect(sessionStorage.getItem(tokenKey)).toBe(goodToken)
    expect(localStorage.length).toBe(0)
    expect(document.cookie).not.toContain(goodToken)
    expect(window.location.href).not.toContain(goodToken)
    for (const call of server.adminCalls()) {
      expect(call.authorization).toBe(`Bearer ${goodToken}`)
      expect(call.path).not.toContain(goodToken)
    }
    for (const spy of logged) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(goodToken)
    }
  })

  it('signs in from the keyboard alone', async () => {
    fakeServer()
    const { user } = renderAdmin('/', { signedIn: false })
    const field = screen.getByLabelText(/Token/)
    // Skip link, "Status page" and the theme menu come first.
    for (let step = 0; step < 6 && document.activeElement !== field; step++) {
      await user.tab()
    }
    expect(field).toHaveFocus()
    await user.keyboard(`${goodToken}{Enter}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toHaveFocus()
  })

  it('refuses an unknown token and stores nothing', async () => {
    fakeServer()
    await signIn('wrong-token')
    expect(await screen.findByText('That token was not accepted.')).toBeVisible()
    expect(sessionStorage.getItem(tokenKey)).toBeNull()
    expect(screen.getByLabelText(/Token/)).toHaveValue('')
  })

  it('says when this address is rate limited', async () => {
    const server = fakeServer()
    server.failNext(429, { error: 'rate_limited' })
    await signIn(goodToken)
    expect(
      await screen.findByText(
        'Too many failed attempts from this address. Wait a minute and try again.',
      ),
    ).toBeVisible()
    expect(sessionStorage.getItem(tokenKey)).toBeNull()
  })

  it('says when the server cannot be reached', async () => {
    const server = fakeServer()
    server.failNext('network')
    await signIn(goodToken)
    expect(await screen.findByText('The server could not be reached.')).toBeVisible()
  })

  it('asks for a token when the field is empty, without a request', async () => {
    const server = fakeServer()
    const view = renderAdmin('/', { signedIn: false })
    await view.user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('Enter a token.')).toBeVisible()
    expect(server.adminCalls()).toEqual([])
  })
})

describe('signing out', () => {
  it('signs out on a 401 from any call, and forgets the token', async () => {
    fakeServer()
    sessionStorage.setItem(tokenKey, 'revoked-token')
    renderAdmin('/incidents', { signedIn: false })
    expect(await screen.findByText('That token was not accepted.')).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    expect(sessionStorage.getItem(tokenKey)).toBeNull()
  })

  it('forgets the token on "Sign out"', async () => {
    fakeServer()
    const view = renderAdmin('/')
    await screen.findByRole('link', { name: 'Some images fail to load' })
    await view.user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText('Signed out.')).toBeVisible()
    expect(sessionStorage.getItem(tokenKey)).toBeNull()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toHaveFocus()
    })
    expect(screen.queryByRole('link', { name: 'Some images fail to load' })).toBeNull()
  })
})
