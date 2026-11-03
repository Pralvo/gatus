// One service's status: what its checks measured, joined with open reports and
// maintenance at a moment. Precedence follows the headline ranks of spec
// section 6: Down, Check failed, Partly down, Degraded, Slower than usual,
// Maintenance, then No checks yet, Check late and Working.

import type { MaintenanceWindow, Report } from '../../api/plugins/types'
import type { EndpointStatus, Result, StatusEvent } from '../../api/types'
import { whyFailed, type Reason } from '../conditions/why'
import { isLate } from '../freshness/staleness'
import { windowFor, windowsAt } from '../notices/maintenance'
import { impactOn, reportsAt, type ActiveReport, type ReportedImpact } from '../notices/reports'
import { utcClockNear } from '../time/format'

import {
  compareWithNormal,
  inOrder,
  isSlow,
  timeOf,
  trendOf,
  type Comparison,
  type Trend,
} from './trend'

export type Tone = 'success' | 'attention' | 'severe' | 'danger' | 'neutral'
export type SourceLabel = 'Measured' | 'Reported' | 'Reported and measured' | 'Scheduled'
export type ServiceState =
  | 'down'
  | 'failed'
  | 'partial'
  | 'degraded'
  | 'slow'
  | 'maintenance'
  | 'no-checks'
  | 'late'
  | 'working'

/** What the page knows about one configured service. */
export interface ServiceInput {
  key: string
  name: string
  group: string
  /** Kept results, in any order. */
  results: Result[]
  /** From the per-service call; left out until it loads. */
  events?: StatusEvent[]
  /** Median of the 7-day hourly history, in milliseconds; null or left out while unknown. */
  usualMs?: number | null
}

/** What the checks alone say. */
export interface Measured {
  hasChecks: boolean
  /** The latest result failed. */
  failing: boolean
  /** Failed results in a row; null when unknown, as in time travel without kept results. */
  failRun: number | null
  failingSince: number | null
  latestAt: number | null
  why: Reason[]
  trend: Trend
  normal: Comparison
  /** The newest check is older than twice the usual gap. */
  late: boolean
}

/** The state of a service at a moment, ready for a row, a headline or a preview. */
export interface ServiceStatus extends Measured {
  key: string
  name: string
  group: string
  state: ServiceState
  /** "Working", "Check failed", "Maintenance until 15:00 UTC", ... */
  word: string
  tone: Tone
  source: SourceLabel | null
  /** Rows show the source label for reported, scheduled and measured-slow states. */
  showSource: boolean
  /** The worst open report naming this service. */
  reported: ReportedImpact | null
  /** The maintenance window in progress over this service. */
  maintenance: MaintenanceWindow | null
}

/** Reports and maintenance as they stood at a moment, with the moment itself. */
export interface Moment {
  at: number
  reports: ActiveReport[]
  /** Windows in progress at the moment. */
  windows: MaintenanceWindow[]
}

/** Builds the moment from every loaded report and window. */
export function momentAt(at: number, reports: Report[], windows: MaintenanceWindow[]): Moment {
  return { at, reports: reportsAt(reports, at), windows: windowsAt(windows, at) }
}

/** The start of the current failure: the results' run, or the event that began it if earlier. */
function failureStart(
  run: Trend,
  events: StatusEvent[] | undefined,
  ordered: Result[],
): number | null {
  if (run.kind !== 'failing') {
    return null
  }
  if (run.run < ordered.length || events === undefined) {
    return run.since
  }
  // Every kept result failed, so the failure may have begun before them.
  const began = events
    .filter((event) => event.type === 'UNHEALTHY')
    .map((event) => Date.parse(event.timestamp))
    .filter((time) => Number.isFinite(time) && time <= run.latestAt)
  const latest = began.length === 0 ? run.since : Math.max(...began)
  return Math.min(latest, run.since)
}

/** Measures a service from its kept results at `now`. */
export function measure(input: ServiceInput, now: number): Measured {
  const ordered = inOrder(input.results)
  const latest = ordered.at(-1)
  const trend = trendOf(ordered)
  const failing = latest?.success === false
  return {
    hasChecks: latest !== undefined,
    failing,
    failRun: trend.kind === 'failing' ? trend.run : 0,
    failingSince: failureStart(trend, input.events, ordered),
    latestAt: latest === undefined ? null : timeOf(latest),
    why: whyFailed(latest),
    trend,
    normal: compareWithNormal(ordered, input.usualMs ?? null),
    late: isLate(ordered, now),
  }
}

interface Classified {
  state: ServiceState
  source: SourceLabel | null
}

function reportedSource(measuredToo: boolean): SourceLabel {
  return measuredToo ? 'Reported and measured' : 'Reported'
}

function classifyState(
  measured: Measured,
  reported: ReportedImpact | null,
  window: MaintenanceWindow | null,
): Classified {
  const impact = reported?.impact
  const slow = isSlow(measured.normal)
  if (impact === 'major') {
    return { state: 'down', source: reportedSource(measured.failing) }
  }
  if (measured.failing) {
    return { state: 'failed', source: 'Measured' }
  }
  if (impact === 'partial') {
    return { state: 'partial', source: 'Reported' }
  }
  if (impact === 'degraded') {
    return { state: 'degraded', source: reportedSource(slow) }
  }
  if (slow) {
    return { state: 'slow', source: 'Measured' }
  }
  if (window !== null || impact === 'maintenance') {
    return { state: 'maintenance', source: window === null ? 'Reported' : 'Scheduled' }
  }
  if (!measured.hasChecks) {
    return { state: 'no-checks', source: null }
  }
  return { state: measured.late ? 'late' : 'working', source: 'Measured' }
}

const tones = new Map<ServiceState, Tone>([
  ['down', 'danger'],
  ['failed', 'danger'],
  ['partial', 'severe'],
  ['degraded', 'attention'],
  ['slow', 'attention'],
  ['maintenance', 'neutral'],
  ['no-checks', 'neutral'],
  ['late', 'attention'],
  ['working', 'success'],
])

const words = new Map<ServiceState, string>([
  ['down', 'Down'],
  ['failed', 'Check failed'],
  ['partial', 'Partly down'],
  ['degraded', 'Degraded'],
  ['slow', 'Slower than usual'],
  ['maintenance', 'Maintenance'],
  ['no-checks', 'No checks yet'],
  ['late', 'Check late'],
  ['working', 'Working'],
])

function wordFor(
  state: ServiceState,
  measured: Measured,
  window: MaintenanceWindow | null,
  at: number,
): string {
  if (state === 'degraded' && isSlow(measured.normal)) {
    return 'Slower than usual'
  }
  if (state === 'maintenance' && window !== null) {
    return `Maintenance until ${utcClockNear(window.end, at)}`
  }
  return words.get(state) ?? 'Working'
}

/** Joins measurements with the reports and maintenance of a moment. */
export function classify(
  identity: Pick<ServiceInput, 'key' | 'name' | 'group'>,
  measured: Measured,
  moment: Moment,
): ServiceStatus {
  const reported = impactOn(moment.reports, identity.key)
  const window = windowFor(moment.windows, identity.key)
  const { state, source } = classifyState(measured, reported, window)
  return {
    key: identity.key,
    name: identity.name,
    group: identity.group,
    ...measured,
    state,
    word: wordFor(state, measured, window, moment.at),
    tone: tones.get(state) ?? 'neutral',
    source,
    showSource: ['down', 'partial', 'degraded', 'slow', 'maintenance'].includes(state),
    reported,
    maintenance: window,
  }
}

/** The status of each service now. `moment.at` is now. */
export function serviceStatuses(inputs: ServiceInput[], moment: Moment): ServiceStatus[] {
  return inputs.map((input) => classify(input, measure(input, moment.at), moment))
}

/**
 * Joins the minute cycle's statuses with each service's events and usual
 * speed, which load separately. Missing events stay missing, not empty.
 */
export function serviceInputs(
  statuses: EndpointStatus[],
  events: Map<string, StatusEvent[]> = new Map(),
  usual: Map<string, number | null> = new Map(),
): ServiceInput[] {
  return statuses.map((status) => {
    const input: ServiceInput = {
      key: status.key,
      name: status.name ?? status.key,
      group: status.group ?? '',
      results: status.results,
      usualMs: usual.get(status.key) ?? null,
    }
    const loaded = events.get(status.key)
    if (loaded !== undefined) {
      input.events = loaded
    }
    return input
  })
}
