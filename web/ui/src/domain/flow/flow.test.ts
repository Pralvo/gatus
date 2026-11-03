import { describe, expect, it } from 'vitest'

import type { Result, SuiteResult, SuiteStatus } from '../../api/types'
import { at, result } from '../../test/fixtures'

import {
  chooseRun,
  flowRuns,
  missingRunMessage,
  notRunText,
  runLabel,
  runSentence,
  stepCount,
  stepWhy,
} from './flow'

function step(name: string, ok: boolean, ms: number): Result {
  return { ...result({ minute: 0, ok, ms }), name }
}

function run(minute: number, steps: Result[], errors?: string[]): SuiteResult {
  const built: SuiteResult = {
    name: 'Sign-in flow',
    success: steps.every((one) => one.success) && errors === undefined,
    timestamp: new Date(at(minute)).toISOString(),
    duration: steps.reduce((sum, one) => sum + one.duration, 0),
    endpointResults: steps,
  }
  if (errors !== undefined) {
    built.errors = errors
  }
  return built
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
const status: SuiteStatus = {
  key: 'flows_sign-in',
  name: 'Sign-in flow',
  results: [passing, failing],
}

describe('flowRuns', () => {
  it('lists runs newest first, with numbered steps', () => {
    const runs = flowRuns(status)
    expect(runs.map((one) => one.id)).toEqual([
      new Date(at(55)).toISOString(),
      new Date(at(50)).toISOString(),
    ])
    expect(runs[0]?.steps.map((one) => [one.number, one.name, one.passed])).toEqual([
      [1, 'Open the page', true],
      [2, 'Find the form', true],
      [3, 'Sign in', false],
    ])
    expect(stepCount(runs)).toBe(4)
  })

  it('skips runs with unreadable times and names unnamed steps', () => {
    const odd: SuiteStatus = {
      key: 'x',
      results: [{ ...passing, timestamp: 'never' }, run(10, [{ ...step('', true, 10) }])],
    }
    const runs = flowRuns(odd)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.steps[0]?.name).toBe('Step 1')
  })
})

describe('words', () => {
  const [latest, earlier] = flowRuns(status)
  if (latest === undefined || earlier === undefined) {
    throw new Error('no runs')
  }

  it('says how a run went', () => {
    expect(runSentence(latest, 4)).toBe('Failed. Step 3 of 4, Sign in, failed after 800 ms.')
    expect(runSentence(earlier, 4)).toBe('Passed. All 4 steps passed in 2.1 s.')
    const [only] = flowRuns({ key: 'one', results: [run(0, [step('Ping', true, 90)])] })
    expect(only === undefined ? '' : runSentence(only, 1)).toBe(
      'Passed. Its only step passed in 90 ms.',
    )
    const [timedOut] = flowRuns({
      key: 'slow',
      results: [run(0, [step('Ping', true, 90)], ['suite execution timed out after 2m0s'])],
    })
    expect(timedOut === undefined ? '' : runSentence(timedOut, 1)).toBe(
      'Failed: suite execution timed out after 2m0s.',
    )
  })

  it('labels runs for the list', () => {
    expect(runLabel(latest, at(61))).toBe('13:55 UTC · Failed at step 3 · 1.5 s')
    expect(runLabel(earlier, at(61 + 24 * 60))).toBe('2 Nov, 13:50 UTC · Passed · 2.1 s')
  })

  it('explains failed steps and the steps that did not run', () => {
    expect(latest.steps.map(stepWhy)).toEqual([
      null,
      null,
      'answered with error 503; it needs a code below 500',
    ])
    expect(notRunText(latest, 4)).toBe('1 later step did not run, because an earlier step failed.')
    expect(notRunText(latest, 5)).toBe('2 later steps did not run, because an earlier step failed.')
    expect(notRunText(earlier, 4)).toBeNull()
  })

  it('chooses the run ?run= names, or the newest', () => {
    const runs = flowRuns(status)
    expect(chooseRun(runs, null)).toEqual({ run: latest, missing: false })
    expect(chooseRun(runs, earlier.id)).toEqual({ run: earlier, missing: false })
    expect(chooseRun(runs, '<script>')).toEqual({ run: latest, missing: true })
    expect(chooseRun([], null)).toEqual({ run: null, missing: false })
    expect(missingRunMessage).toBe('That run is no longer kept. Showing the latest run.')
  })
})
