// A flow (spec 4.3): a Gatus suite, a series of steps that run in order. Each
// run passes only when every step does; after a failed step, later steps run
// only when they are set to always run, so a run may hold fewer steps than
// the flow has. "Suites" are called "flows" in everything a visitor reads.

import type { ConditionResult, Result, SuiteResult, SuiteStatus } from '../../api/types'
import { whyFailed, whyText, type Reason } from '../conditions/why'
import { durationText, nanosToMs, utcClockNear } from '../time/format'

export interface FlowStep {
  /** 1 for the first step. */
  number: number
  name: string
  passed: boolean
  durationMs: number
  /** Why the step failed; empty when it passed. */
  why: Reason[]
  conditions: ConditionResult[]
  errors: string[]
}

export interface FlowRun {
  /** The run's ?run= value: its start time as an ISO string. */
  id: string
  at: number
  passed: boolean
  durationMs: number
  steps: FlowStep[]
  /** Errors of the run itself, such as a timeout, as the server wrote them. */
  errors: string[]
}

function stepOf(result: Result, index: number): FlowStep {
  return {
    number: index + 1,
    name:
      result.name !== undefined && result.name !== '' ? result.name : `Step ${String(index + 1)}`,
    passed: result.success,
    durationMs: nanosToMs(result.duration),
    why: whyFailed(result),
    conditions: result.conditionResults ?? [],
    errors: (result.errors ?? []).filter((error) => error.trim() !== ''),
  }
}

function runOf(result: SuiteResult): FlowRun | null {
  const at = Date.parse(result.timestamp)
  if (!Number.isFinite(at)) {
    return null
  }
  return {
    id: new Date(at).toISOString(),
    at,
    passed: result.success,
    durationMs: nanosToMs(result.duration),
    steps: (result.endpointResults ?? []).map(stepOf),
    errors: (result.errors ?? []).filter((error) => error.trim() !== ''),
  }
}

/** The flow's kept runs, newest first. */
export function flowRuns(status: SuiteStatus): FlowRun[] {
  return (status.results ?? [])
    .map(runOf)
    .filter((run) => run !== null)
    .sort((a, b) => b.at - a.at)
}

/** How many steps the flow has, as far as the kept runs show: the most any run holds. */
export function stepCount(runs: FlowRun[]): number {
  return Math.max(0, ...runs.map((run) => run.steps.length))
}

/** The run ?run= names, or the newest; `missing` when ?run= names a run that is not kept. */
export function chooseRun(
  runs: FlowRun[],
  param: string | null,
): { run: FlowRun | null; missing: boolean } {
  const newest = runs.at(0) ?? null
  if (param === null) {
    return { run: newest, missing: false }
  }
  const wanted = Date.parse(param)
  const found = runs.find((run) => run.at === wanted)
  return found === undefined ? { run: newest, missing: true } : { run: found, missing: false }
}

export const missingRunMessage = 'That run is no longer kept. Showing the latest run.'

/**
 * The run in words: "Failed. Step 3 of 4, Sign in, failed after 0.8 s." or
 * "Passed. All 4 steps passed in 2.1 s."
 */
export function runSentence(run: FlowRun, steps: number): string {
  const total = Math.max(steps, run.steps.length)
  if (run.passed) {
    if (total === 1) {
      return `Passed. Its only step passed in ${durationText(run.durationMs)}.`
    }
    return `Passed. All ${String(total)} steps passed in ${durationText(run.durationMs)}.`
  }
  const failed = run.steps.find((step) => !step.passed)
  if (failed !== undefined) {
    return `Failed. Step ${String(failed.number)} of ${String(total)}, ${failed.name}, failed after ${durationText(failed.durationMs)}.`
  }
  const reason = run.errors.length === 0 ? 'the run gave no reason' : run.errors.join(', and ')
  return `Failed: ${reason}.`
}

/** "2 Nov, 13:50 UTC · Failed at step 3 · 2.1 s", for the list of runs. */
export function runLabel(run: FlowRun, reference: number): string {
  const failed = run.steps.find((step) => !step.passed)
  let result = run.passed ? 'Passed' : 'Failed'
  if (failed !== undefined) {
    result = `Failed at step ${String(failed.number)}`
  }
  return `${utcClockNear(run.at, reference)} · ${result} · ${durationText(run.durationMs)}`
}

/** "Sign in: answered with error 503; it needs 200", for a failed step. */
export function stepWhy(step: FlowStep): string | null {
  return step.passed ? null : whyText(step.why)
}

/** "1 later step did not run, because an earlier step failed." */
export function notRunText(run: FlowRun, steps: number): string | null {
  const missing = steps - run.steps.length
  if (missing <= 0 || run.passed) {
    return null
  }
  return missing === 1
    ? '1 later step did not run, because an earlier step failed.'
    : `${String(missing)} later steps did not run, because an earlier step failed.`
}
