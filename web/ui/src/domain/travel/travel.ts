// Time travel (spec 9.3): the status as it stood at a past UTC minute, rebuilt
// from what is kept. A service's state at T is its last event at or before T.
// Kept results at or before T add the reason, the run and the speed. Reports
// count from their publication, with the stage of their latest update by T;
// maintenance counts when its window contains T.

import type { MaintenanceWindow, Report } from '../../api/plugins/types'
import type { Result } from '../../api/types'
import { whyFailed } from '../conditions/why'
import { stateAt } from '../record/intervals'
import {
  classify,
  momentAt,
  type Measured,
  type Moment,
  type ServiceInput,
  type ServiceStatus,
} from '../status/service'
import { compareWithNormal, inOrder, timeOf, trendOf } from '../status/trend'
import { hourMs, utcDateTime } from '../time/format'

export interface TravelInput {
  /** The moment, already parsed and rounded by parseAt. */
  at: number
  /** Kept results (any time), events and usual speed of each service. */
  services: ServiceInput[]
  /** Reports with every update where loaded, so the stage at T is known. */
  reports: Report[]
  windows: MaintenanceWindow[]
}

export interface TravelView {
  at: number
  moment: Moment
  services: ServiceStatus[]
  /** Each service's kept results at or before T, oldest first, for the strip. */
  results: Map<string, Result[]>
  /** Whether any service still has check details at T. */
  checksKept: boolean
  /** Messages for the page, such as the check-details message of spec section 8. */
  messages: string[]
}

export const checksNotKeptMessage =
  'Check details for this time are no longer kept. The record keeps when each service started and stopped failing.'

const none: Measured['trend'] = { kind: 'none' }

type EventState = ReturnType<typeof stateAt> | undefined

/** Failing at T, and since when: the events decide when loaded, else the kept results. */
function failureAt(
  state: EventState,
  latest: Result | undefined,
  trend: Measured['trend'],
): { failing: boolean; since: number | null } {
  if (state !== undefined) {
    return state?.type === 'UNHEALTHY'
      ? { failing: true, since: state.at }
      : { failing: false, since: null }
  }
  const failing = latest?.success === false
  return { failing, since: failing && trend.kind === 'failing' ? trend.since : null }
}

/** What the checks said at T, from events first and kept results second. */
export function measureAt(input: ServiceInput, at: number): { measured: Measured; kept: Result[] } {
  const kept = inOrder(input.results).filter((result) => timeOf(result) <= at)
  const latest = kept.at(-1)
  const state: EventState = input.events === undefined ? undefined : stateAt(input.events, at)
  const trend = latest === undefined ? none : trendOf(kept)
  const { failing, since } = failureAt(state, latest, trend)
  const latestAt = latest === undefined ? (state?.at ?? null) : timeOf(latest)
  const measured: Measured = {
    hasChecks: latestAt !== null,
    failing,
    failRun: failing && trend.kind === 'failing' ? trend.run : null,
    failingSince: since,
    latestAt,
    why: failing ? whyFailed(latest) : [],
    trend,
    normal: compareWithNormal(kept, input.usualMs ?? null),
    late: false,
  }
  return { measured, kept }
}

/** Rebuilds every service, report and window as it stood at T. */
export function statusAt(input: TravelInput): TravelView {
  const moment = momentAt(input.at, input.reports, input.windows)
  const results = new Map<string, Result[]>()
  const services = input.services.map((service) => {
    const { measured, kept } = measureAt(service, input.at)
    results.set(service.key, kept)
    return classify(service, measured, moment)
  })
  const checksKept = [...results.values()].some((kept) => kept.length > 0)
  return {
    at: input.at,
    moment,
    services,
    results,
    checksKept,
    messages: checksKept ? [] : [checksNotKeptMessage],
  }
}

/**
 * The banner: "You are looking at 2 Nov 2026, 13:50 UTC. This view is rebuilt
 * from the record: checks, reports and maintenance. Check details older than
 * about 8 hours and hourly speeds older than 2 days are not kept. Report
 * titles show their current wording." `detailsFrom` is the oldest time every
 * service still has check details for; null leaves that part out.
 */
export function travelBanner(at: number, detailsFrom: number | null, now: number): string {
  const kept =
    detailsFrom === null
      ? 'Hourly speeds older than 2 days are not kept.'
      : `Check details older than about ${String(Math.max(1, Math.round((now - detailsFrom) / hourMs)))} hours and hourly speeds older than 2 days are not kept.`
  return `You are looking at ${utcDateTime(at)}. This view is rebuilt from the record: checks, reports and maintenance. ${kept} Report titles show their current wording.`
}

/** The time from which every service still has check details: the latest of their oldest results. */
export function keptFrom(services: { results: Result[] }[]): number | null {
  const oldest = services
    .map((service) => inOrder(service.results).at(0))
    .filter((result) => result !== undefined)
    .map(timeOf)
  return oldest.length === 0 ? null : Math.max(...oldest)
}
