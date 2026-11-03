// Everything the home page shows, now or at a past moment (spec 4.1, 9.2 and
// 9.3), joined from the data hooks and worded by the domain layer. The page
// components only lay it out.

import { useSearchParams } from 'react-router'

import type { MaintenanceWindow, Report, ReportPage } from '../../api/plugins/types'
import type { Result } from '../../api/types'
import { usePageConfig } from '../../config/context'
import { useMinuteCycle, useNow } from '../../data/cycle'
import { useFullReports, useServiceEvents, useUsualSpeeds } from '../../data/service'
import {
  freshnessText,
  noticesFailedMessage,
  refreshFailedMessage,
  type RefreshState,
} from '../../domain/freshness/refresh'
import { isStale, newestCheckAt } from '../../domain/freshness/staleness'
import { headline, type Headline } from '../../domain/headline/headline'
import { probedKeys } from '../../domain/justme/verdict'
import { recordStart } from '../../domain/record/intervals'
import {
  momentAt,
  serviceInputs,
  serviceStatuses,
  type ServiceInput,
  type ServiceStatus,
} from '../../domain/status/service'
import { homeStory, type StoryItem } from '../../domain/story/story'
import { atLink, parseAt } from '../../domain/time/at'
import { ticketText } from '../../domain/travel/ticket'
import { keptFrom, statusAt, travelBanner } from '../../domain/travel/travel'

export type HomePhase = 'loading' | 'error' | 'ready'

export interface HomeTravel {
  at: number
  /** "You are looking at 2 Nov 2026, 13:50 UTC. ..." */
  banner: string
  /** Further messages, such as "Check details for this time are no longer kept. ..." */
  messages: string[]
  /** The "Copy for a ticket" text. */
  ticket: string
  /** The "Copy link" address. */
  link: string
}

export interface HomeView {
  phase: HomePhase
  now: number
  /** Now, or the time-travel moment. */
  reference: number
  travel: HomeTravel | null
  /** The message for an unusable ?at=, shown over the live page. */
  atProblem: string | null
  headline: Headline
  services: ServiceStatus[]
  /** Each service's kept results, events and usual speed. */
  inputs: ServiceInput[]
  /** The results each strip shows: every kept one now, those up to T in time travel. */
  results: Map<string, Result[]>
  story: StoryItem[]
  newest: number | null
  /** The newest check is older than 15 minutes (rank 9 and half-opacity strips). */
  stale: boolean
  freshness: string | null
  refreshFailed: string | null
  noticesFailed: string | null
  /** Reports for the record and past notices: with every update in time travel. */
  reports: Report[]
  /** The first page of reports says there are more: older notices are paged in on request. */
  reportsMore: boolean
  windows: MaintenanceWindow[]
  /** When monitoring began, from the events; null until they load. */
  recordStart: number | null
  /** Some service's events have not answered yet: the record waits for them. */
  eventsLoading: boolean
  probed: Set<string>
  refreshing: boolean
  refreshNow: () => Promise<void>
}

const none: Report[] = []
const noReports: ReportPage = { reports: none, page: 1, more: false }

function siteOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

type Shared = Pick<
  HomeView,
  | 'phase'
  | 'now'
  | 'atProblem'
  | 'inputs'
  | 'windows'
  | 'reportsMore'
  | 'recordStart'
  | 'eventsLoading'
  | 'refreshing'
  | 'refreshNow'
  | 'noticesFailed'
>

interface LiveInput {
  loaded: boolean
  reports: Report[]
  checkNames: string[]
  refresh: RefreshState
}

/** The page now: classified services, the headline, freshness and refresh warnings. */
function liveView(shared: Shared, input: LiveInput): HomeView {
  const { now, inputs } = shared
  const moment = momentAt(now, input.reports, shared.windows)
  const services = serviceStatuses(inputs, moment)
  const probed = probedKeys(input.checkNames, services)
  const newest = newestCheckAt(inputs)
  return {
    ...shared,
    reference: now,
    travel: null,
    headline: headline({
      loaded: input.loaded,
      services,
      moment,
      newestCheckAt: newest,
      hasProbe: (key) => probed.has(key),
    }),
    services,
    results: new Map(inputs.map((service) => [service.key, service.results])),
    story: homeStory(services, moment),
    newest,
    stale: isStale(newest, now),
    freshness: freshnessText(input.refresh.lastSuccessAt, newest, now),
    refreshFailed: refreshFailedMessage(input.refresh, now),
    reports: input.reports,
    probed,
  }
}

interface TravelInput {
  at: number
  loaded: boolean
  reports: Report[]
  siteName: string
}

/** The page as it stood at T, in the past tense, with the banner and ticket text. */
function travelView(shared: Shared, input: TravelInput): HomeView {
  const { at, reports } = input
  const view = statusAt({ at, services: shared.inputs, reports, windows: shared.windows })
  const found = headline({
    loaded: input.loaded,
    services: view.services,
    moment: view.moment,
    newestCheckAt: null,
    tense: 'past',
  })
  const link = atLink(siteOrigin(), at)
  const ticket = ticketText({
    at,
    headline: found,
    reports: view.moment.reports,
    link,
    siteName: input.siteName,
  })
  return {
    ...shared,
    reference: at,
    travel: {
      at,
      banner: travelBanner(at, keptFrom(shared.inputs), shared.now),
      messages: view.messages,
      ticket,
      link,
    },
    headline: found,
    services: view.services,
    results: view.results,
    story: homeStory(view.services, view.moment),
    newest: null,
    stale: false,
    freshness: null,
    refreshFailed: null,
    reports,
    probed: new Set(),
  }
}

/** The home page's data, for now or for the ?at= moment. */
export function useHomeView(): HomeView {
  const [params] = useSearchParams()
  const raw = params.get('at')
  const { browserChecks, header } = usePageConfig()
  const now = useNow()
  // Whether to refresh is decided before the events load; a time before the
  // record is found only once they have, and then shows its message.
  const live = parseAt(raw, { now, recordStart: null })?.ok !== true
  const cycle = useMinuteCycle({ live })
  const statuses = cycle.statuses.data
  const keys = (statuses ?? []).map((status) => status.key)
  const events = useServiceEvents(keys, { live })
  const usual = useUsualSpeeds(keys, { live })
  const { reports: listed, more: reportsMore } = cycle.reports.data ?? noReports
  const full = useFullReports(live ? none : listed)

  const inputs = serviceInputs(statuses ?? [], events.byKey, usual.byKey)
  const start = recordStart(inputs.map((input) => input.events))
  const parsed = parseAt(raw, { now, recordStart: start })
  const loaded = statuses !== undefined
  const errorPhase: HomePhase = cycle.statuses.isError ? 'error' : 'loading'
  const shared: Shared = {
    phase: loaded ? 'ready' : errorPhase,
    now,
    atProblem: parsed === null || parsed.ok ? null : parsed.message,
    inputs,
    windows: cycle.maintenance.data ?? [],
    reportsMore,
    recordStart: start,
    eventsLoading: events.loading,
    refreshing: cycle.statuses.isFetching,
    refreshNow: cycle.refreshNow,
    noticesFailed: cycle.noticesFailed ? noticesFailedMessage : null,
  }
  if (parsed?.ok === true) {
    return travelView(shared, {
      at: parsed.at,
      loaded,
      reports: [...full.byKey.values()],
      siteName: header,
    })
  }
  return liveView(shared, {
    loaded,
    reports: listed,
    checkNames: browserChecks.map((check) => check.name),
    refresh: cycle.refresh,
  })
}
