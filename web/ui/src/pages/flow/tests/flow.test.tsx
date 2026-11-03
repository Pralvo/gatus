// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Result, SuiteResult, SuiteStatus } from '../../../api/types'
import { at, result } from '../../../test/fixtures'
import { pralvoEstate, renderHome, setNow } from '../../home/tests/harness'
import { serveService, type Extras } from '../../service/tests/harness'

// jsdom has no ResizeObserver, which Primer's Dialog asks for.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
})

function step(name: string, ok: boolean, ms: number, errors?: string[]): Result {
  const built: Result = { ...result({ minute: 0, ok, ms }), name }
  if (errors !== undefined) {
    built.errors = errors
  }
  return built
}

function run(minute: number, steps: Result[]): SuiteResult {
  return {
    name: 'Sign-in flow',
    success: steps.every((one) => one.success),
    timestamp: new Date(at(minute)).toISOString(),
    duration: steps.reduce((sum, one) => sum + one.duration, 0),
    endpointResults: steps,
  }
}

const passing = run(50, [
  step('Open the page', true, 300),
  step('Find the form', true, 400),
  step('Sign in', true, 800),
  step('Sign out', true, 600),
])
const failing = run(55, [
  step('Open the page', true, 300),
  step('Find the form', true, 400),
  step('Sign in', false, 800),
])

function flow(results: SuiteResult[]): SuiteStatus {
  return { key: 'flows_sign-in', name: 'Sign-in flow', group: 'Flows', results }
}

function serveFlows(flows: SuiteStatus[], extras: Extras = {}) {
  return serveService(pralvoEstate(), { ...extras, flows })
}

function h1(): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name: 'Sign-in flow' })
}

describe('flow page', () => {
  it('shows a passing flow and its steps in order', async () => {
    setNow()
    serveFlows([flow([passing])])
    renderHome('/suites/flows_sign-in')
    await h1()
    expect(document.title).toBe('Sign-in flow · Pralvo status')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Breadcrumbs' })).toHaveTextContent('Flows')
    const latest = screen.getByRole('region', { name: 'Latest run' })
    expect(latest).toHaveTextContent('Latest run passed')
    expect(latest).toHaveTextContent('Passed. All 4 steps passed in 2.1 s.')
    const steps = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(steps.map((item) => item.textContent)).toEqual([
      'Open the pagePassed300 msDetails',
      'Find the formPassed400 msDetails',
      'Sign inPassed800 msDetails',
      'Sign outPassed600 msDetails',
    ])
    expect(screen.getByRole('list', { name: 'Steps' }).tagName).toBe('OL')
  })

  it('shows a failing run: which step, why, and what did not run', async () => {
    setNow()
    serveFlows([flow([passing, failing])])
    const { user } = renderHome('/suites/flows_sign-in')
    await h1()
    const latest = screen.getByRole('region', { name: 'Latest run' })
    expect(latest).toHaveTextContent('Latest run failed')
    expect(latest).toHaveTextContent('Failed. Step 3 of 4, Sign in, failed after 800 ms.')
    const list = screen.getByRole('list', { name: 'Steps' })
    const signIn = within(list).getAllByRole('listitem')[2]
    expect(signIn).toHaveTextContent('Sign inFailed800 ms')
    expect(signIn).toHaveTextContent('Why: answered with error 503; it needs a code below 500.')
    expect(
      screen.getByText('1 later step did not run, because an earlier step failed.'),
    ).toBeVisible()
    const opener = screen.getByRole('button', { name: 'Details of step 3, Sign in' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Step 3: Sign in' })
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Step 3: Sign in' })).toBeVisible()
    expect(dialog).toHaveTextContent('Not met')
    expect(within(dialog).getByText('[STATUS] (503) < 500', { selector: 'code' })).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(opener).toHaveFocus()
  })

  it('chooses a run into ?run= and shows its steps', async () => {
    setNow()
    serveFlows([flow([passing, failing])])
    const { user } = renderHome('/suites/flows_sign-in')
    await h1()
    const runs = screen.getByRole('listbox', { name: 'Recent runs' })
    const options = within(runs).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      '13:55 UTC · Failed at step 3 · 1.5 s',
      '13:50 UTC · Passed · 2.1 s',
    ])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.click(within(runs).getByRole('option', { name: /13:50 UTC · Passed/ }))
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('run')).toBe(
        new Date(at(50)).toISOString(),
      )
    })
    expect(within(runs).getByRole('option', { name: /13:50 UTC · Passed/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem'),
    ).toHaveLength(4)
    expect(screen.getByRole('region', { name: 'Latest run' })).toHaveTextContent(
      'Latest run failed',
    )
    // Choosing a run is not a new page: focus stays in the list.
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus()
  })

  it('opens the run ?run= names, and says when it is no longer kept', async () => {
    setNow()
    serveFlows([flow([passing, failing])])
    renderHome(`/suites/flows_sign-in?run=${new Date(at(50)).toISOString()}`)
    await h1()
    expect(
      within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem'),
    ).toHaveLength(4)
    window.history.pushState({}, '', '/')
    renderHome('/suites/flows_sign-in?run=2020-01-01T00:00:00.000Z')
    expect(
      await screen.findByText('That run is no longer kept. Showing the latest run.'),
    ).toBeVisible()
  })

  it('says when a flow has not run yet', async () => {
    setNow()
    serveFlows([flow([])])
    renderHome('/suites/flows_sign-in')
    await h1()
    expect(screen.getByRole('region', { name: 'Latest run' })).toHaveTextContent(
      'No runs yetThis flow has not run yet.',
    )
  })

  it('says there is no flow at an unknown address', async () => {
    setNow()
    serveFlows([])
    renderHome('/suites/nothing-here')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'There is no flow at this address' }),
    ).toBeVisible()
    expect(document.title).toBe('Not found · Pralvo status')
    expect(screen.getByRole('link', { name: 'Go to the status page' })).toHaveAttribute('href', '/')
  })

  it('offers to try again when the flow cannot load', async () => {
    setNow()
    const broken = new Set(['/api/v1/suites/flows_sign-in/statuses'])
    serveFlows([flow([passing])], { broken })
    const { user } = renderHome('/suites/flows_sign-in')
    expect(await screen.findByRole('heading', { level: 1, name: 'Flow unavailable' })).toBeVisible()
    broken.clear()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await h1()).toBeVisible()
  })

  it('shows hostile step names and errors as text', async () => {
    setNow()
    const hostile = run(55, [
      step('<img src=x onerror=alert(1)>', false, 10, ['<script>x()</script>']),
    ])
    serveFlows([flow([hostile])])
    renderHome('/suites/flows_sign-in')
    await h1()
    const list = screen.getByRole('list', { name: 'Steps' })
    expect(list).toHaveTextContent(
      '<img src=x onerror=alert(1)>Failed10 msWhy: <script>x()</script>.',
    )
    expect(screen.getByRole('main').querySelector('img[src="x"]')).toBeNull()
    expect(screen.getByRole('main').querySelector('script')).toBeNull()
  })
})
