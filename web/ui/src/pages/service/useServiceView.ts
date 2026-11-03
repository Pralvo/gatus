// Everything the service page shows, now or at a past moment (spec 4.2 and
// 9.3), joined from the same hooks as the home page and worded by the domain
// layer. The page components only lay it out.

import { useParams, useSearchParams } from 'react-router'

import type { MaintenanceWindow, Report } from '../../api/plugins/types'
import type { Result } from '../../api/types'
import { useMinuteCycle, useNow } from '../../data/cycle'
import { useFullReports, useServiceEvents, useUptime, useUsualSpeeds } from '../../data/service'
import {
  freshnessText,
  noticesFailedMessage,
  refreshFailedMessage,
} from '../../domain/freshness/refresh'
import { isStale, newestCheckAt } from '../../domain/freshness/staleness'
import { serviceDetail } from '../../domain/panel/detail'
import { recordStart } from '../../domain/record/intervals'
import {
  momentAt,
  serviceInputs,
  serviceStatuses,
  type ServiceInput,
  type ServiceStatus,
} from '../../domain/status/service'
import { parseAt } from '../../domain/time/at'
import { keptFrom, statusAt, travelBanner } from '../../domain/travel/travel'

export type ServicePhase = 'loading' | 'error' | 'missing' | 'ready'

export interface ServiceTravel {
  at: number
  /** "You are looking at 2 Nov 2026, 13:50 UTC. ..." */
  banner: string
}

/** The service as it stands, once the statuses have loaded and name it. */
export interface ServiceReady {
  service: ServiceStatus
  input: ServiceInput
  /** The results the strip shows: every kept one now, those up to T in time travel. */
  results: Result[]
  detail: string
  stale: boolean
  freshness: string | null
  /** The 30-day share of passing checks; null until it loads, when it failed, or in time travel. */
  uptime: number | null
  uptimeLoading: boolean
}

export interface ServiceView {
  phase: ServicePhase
  key: string
  now: number
  /** Now, or the time-travel moment. */
  reference: number
  travel: ServiceTravel | null
  /** The message for an unusable ?at=, shown over the live page. */
  atProblem: string | null
  ready: ServiceReady | null
  refreshFailed: string | null
  noticesFailed: string | null
  reports: Report[]
  windows: MaintenanceWindow[]
  eventsLoading: boolean
  refreshing: boolean
  refreshNow: () => Promise<void>
}

const none: Report[] = []

interface Joined {
  input: ServiceInput
  service: ServiceStatus
  results: Result[]
  kept: boolean
}

/** Classifies the service now, or as it stood at T with only what was kept by then. */
function join(
  input: ServiceInput,
  reports: Report[],
  windows: MaintenanceWindow[],
  travelAt: number | null,
  now: number,
): Joined | null {
  if (travelAt !== null) {
    const view = statusAt({ at: travelAt, services: [input], reports, windows })
    const [service] = view.services
    const results = view.results.get(input.key) ?? []
    return service === undefined ? null : { input, service, results, kept: results.length > 0 }
  }
  const [service] = serviceStatuses([input], momentAt(now, reports, windows))
  return service === undefined ? null : { input, service, results: input.results, kept: true }
}

interface ReadyContext {
  now: number
  travelAt: number | null
  /** The newest check of every service, now; null in time travel. */
  newest: number | null
  lastSuccessAt: number | null
  uptime: { data?: number | undefined; isPending: boolean; fetchStatus: string }
}

/** The words and figures of a found service. */
function readyOf(joined: Joined, context: ReadyContext): ServiceReady {
  const { now, travelAt, newest } = context
  const stale = isStale(newest, now)
  const past = travelAt === null ? {} : { tense: 'past' as const, kept: joined.kept }
  return {
    service: joined.service,
    input: joined.input,
    results: joined.results,
    detail: serviceDetail(joined.service, { reference: travelAt ?? now, stale, ...past }),
    stale,
    freshness: travelAt === null ? freshnessText(context.lastSuccessAt, newest, now) : null,
    uptime: context.uptime.data ?? null,
    uptimeLoading: context.uptime.isPending && context.uptime.fetchStatus !== 'idle',
  }
}

function phaseOf(loaded: boolean, failed: boolean, found: boolean): ServicePhase {
  if (loaded) {
    return found ? 'ready' : 'missing'
  }
  return failed ? 'error' : 'loading'
}

/** The moment from ?at=, once the events say when the record starts. */
function momentOf(raw: string | null, now: number, inputs: ServiceInput[]) {
  const parsed = parseAt(raw, { now, recordStart: recordStart(inputs.map((one) => one.events)) })
  return {
    travelAt: parsed?.ok === true ? parsed.at : null,
    atProblem: parsed === null || parsed.ok ? null : parsed.message,
  }
}

function travelOf(travelAt: number | null, inputs: ServiceInput[], now: number) {
  return travelAt === null
    ? null
    : { at: travelAt, banner: travelBanner(travelAt, keptFrom(inputs), now) }
}

/** Every request the page makes: the minute cycle, then this service's events, speeds and uptime. */
function useServiceData(key: string, live: boolean) {
  const cycle = useMinuteCycle({ live })
  const status = cycle.statuses.data?.find((candidate) => candidate.key === key)
  const keys = status === undefined ? [] : [key]
  const events = useServiceEvents(keys, { live })
  const usual = useUsualSpeeds(keys, { live })
  const listed = cycle.reports.data?.reports ?? none
  const full = useFullReports(live ? none : listed)
  // Gatus counts uptime back from now, so a past moment shows no 30-day share.
  const uptime = useUptime(key, status !== undefined && live)
  const inputs = serviceInputs(status === undefined ? [] : [status], events.byKey, usual.byKey)
  return { cycle, events, listed, full, uptime, inputs }
}

/** The service page's data, for now or for the ?at= moment. */
export function useServiceView(): ServiceView {
  const key = useParams().key ?? ''
  const [params] = useSearchParams()
  const raw = params.get('at')
  const now = useNow()
  const live = parseAt(raw, { now, recordStart: null })?.ok !== true
  const { cycle, events, listed, full, uptime, inputs } = useServiceData(key, live)
  const statuses = cycle.statuses.data
  const [input] = inputs
  const { travelAt, atProblem } = momentOf(raw, now, inputs)
  const reports = travelAt === null ? listed : [...full.byKey.values()]
  const windows = cycle.maintenance.data ?? []
  const joined = input === undefined ? null : join(input, reports, windows, travelAt, now)
  const context: ReadyContext = {
    now,
    travelAt,
    newest: travelAt === null ? newestCheckAt(statuses ?? []) : null,
    lastSuccessAt: cycle.refresh.lastSuccessAt,
    uptime,
  }
  return {
    phase: phaseOf(statuses !== undefined, cycle.statuses.isError, input !== undefined),
    key,
    now,
    reference: travelAt ?? now,
    travel: travelOf(travelAt, inputs, now),
    atProblem,
    ready: joined === null ? null : readyOf(joined, context),
    refreshFailed: travelAt === null ? refreshFailedMessage(cycle.refresh, now) : null,
    noticesFailed: cycle.noticesFailed ? noticesFailedMessage : null,
    reports,
    windows,
    eventsLoading: events.loading,
    refreshing: cycle.statuses.isFetching,
    refreshNow: cycle.refreshNow,
  }
}
