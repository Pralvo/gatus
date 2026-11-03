// The headline: the H1 and detail line of the answer panel (spec section 6).
// The first rank that applies wins. The home page, time travel and the admin
// public preview all call headline(), so they can never disagree.

import type { Impact } from '../../api/plugins/types'
import { asOfPrefix, isStale } from '../freshness/staleness'
import { impactRank, type ActiveReport } from '../notices/reports'
import type { Moment, ServiceStatus, Tone } from '../status/service'
import { isSlow } from '../status/trend'
import { relativeTime, utcClock, utcClockNear, utcDay } from '../time/format'

import {
  allFailing,
  alsoFailing,
  be,
  checksKeepRunning,
  joinNames,
  measuredSentence,
  oneFailing,
  reportedSentence,
  severalFailing,
  windowSentence,
  type Lead,
  type Tense,
} from './copy'

export type HeadlineKind =
  | 'unavailable'
  | 'down'
  | 'failed'
  | 'partial'
  | 'degraded'
  | 'unnamed-report'
  | 'slow'
  | 'maintenance'
  | 'stale'
  | 'working'
  | 'no-checks'
  | 'nothing-configured'

export interface Headline {
  kind: HeadlineKind
  /** The spec's rank, 1 to 10; null for the two unranked states. */
  rank: number | null
  tone: Tone
  /** The H1. */
  title: string
  /** The detail line under it; null when there is none. */
  detail: string | null
  /** The services the headline names, by key; a report may name keys this page does not monitor. */
  keys: string[]
}

export interface HeadlineInput {
  /** False when the statuses could not be loaded at all. */
  loaded: boolean
  services: ServiceStatus[]
  /** The moment: now, or the time-travel moment, with its open reports and windows. */
  moment: Moment
  /** The newest check of any service; drives "may be out of date". */
  newestCheckAt: number | null
  /** "past" for time travel: "is" becomes "was" and details use the past perfect. */
  tense?: Tense
  /** Whether "Is it just me?" has a probe for a service; adds "Try it from your browser." */
  hasProbe?: (key: string) => boolean
}

interface Named {
  key: string
  name: string
  impact: Impact
  report: ActiveReport
  service: ServiceStatus | undefined
}

/** Every service an open report names, with its worst impact; known services keep their own name. */
function namedByReports(input: HeadlineInput): Named[] {
  const byKey = new Map<string, Named>()
  for (const report of input.moment.reports) {
    for (const endpoint of report.endpoints) {
      const previous = byKey.get(endpoint.key)
      if (previous === undefined || impactRank(endpoint.impact) < impactRank(previous.impact)) {
        const service = input.services.find((candidate) => candidate.key === endpoint.key)
        byKey.set(endpoint.key, {
          key: endpoint.key,
          name: service?.name ?? endpoint.name,
          impact: endpoint.impact,
          report,
          service,
        })
      }
    }
  }
  return [...byKey.values()]
}

interface Context {
  input: HeadlineInput
  tense: Tense
  at: number
  named: Named[]
}

/** A headline, and whether its detail opens with a name, which must keep its capital. */
interface Ranked {
  found: Headline
  leadsWithName: boolean
}

function make(
  kind: HeadlineKind,
  rank: number | null,
  tone: Tone,
  text: { title: string; detail: string | null },
  keys: string[] = [],
): Headline {
  return { kind, rank, tone, title: text.title, detail: text.detail, keys }
}

function ranked(found: Headline, leadsWithName = false): Ranked {
  return { found, leadsWithName }
}

function probeSuffix(context: Context, keys: string[]): string {
  const probe = context.input.hasProbe
  return context.tense === 'present' && probe !== undefined && keys.some((key) => probe(key))
    ? ' Try it from your browser.'
    : ''
}

function reportRank(context: Context, impact: Impact): Ranked | null {
  const named = context.named.filter((entry) => entry.impact === impact)
  const [first] = named
  if (first === undefined) {
    return null
  }
  const names = joinNames(named.map((entry) => entry.name))
  const keys = named.map((entry) => entry.key)
  const verb = be(named.length, context.tense)
  let detail = reportedSentence(first.report, context.at)
  if (impact === 'major') {
    const failing = named.length === 1 && first.service?.failing === true ? first.service : null
    detail += failing === null ? '' : ` ${alsoFailing(failing, context.tense, context.at)}`
    const title = `${names} ${verb} down`
    return ranked(
      make('down', 2, 'danger', { title, detail: detail + probeSuffix(context, keys) }, keys),
    )
  }
  if (impact === 'partial') {
    return ranked(
      make('partial', 4, 'attention', { title: `${names} ${verb} partly down`, detail }, keys),
    )
  }
  const known = named.map((entry) => entry.service).filter((service) => service !== undefined)
  const slow = known.filter((service) => isSlow(service.normal))
  const allSlow = slow.length > 0 && slow.length === named.length
  detail += slow.length === 0 ? '' : ` ${measuredSentence(slow, context.tense)}`
  const title = `${names} ${verb} ${allSlow ? 'slower than usual' : 'degraded'}`
  return ranked(make('degraded', 5, 'attention', { title, detail }, keys))
}

function failedRank(context: Context): Ranked | null {
  const { services } = context.input
  const failing = services.filter((service) => service.failing)
  const [first] = failing
  if (first === undefined) {
    return null
  }
  const keys = failing.map((service) => service.key)
  const had = context.tense === 'present' ? '' : 'had '
  const probe = probeSuffix(context, keys)
  if (failing.length >= 2 && failing.length === services.length) {
    const title = `All services ${had}failed their latest check`
    const detail = allFailing(failing, context.tense, context.at)
    return ranked(make('failed', 3, 'danger', { title, detail }, keys))
  }
  if (failing.length === 1) {
    const title = `${first.name} ${had}failed its latest check`
    const detail = oneFailing(first, context.tense, context.at) + probe
    return ranked(make('failed', 3, 'danger', { title, detail }, keys))
  }
  const names = joinNames(failing.map((service) => service.name))
  const lead = severalFailing(failing, context.tense, context.at)
  const title = `${names} ${had}failed their latest check`
  return ranked(
    make('failed', 3, 'danger', { title, detail: lead.text + probe }, keys),
    lead.leadsWithName,
  )
}

function unnamedRank(context: Context): Ranked | null {
  const report = context.input.moment.reports.find((candidate) => candidate.endpoints.length === 0)
  if (report === undefined) {
    return null
  }
  const title =
    context.tense === 'present' ? 'We are looking into a problem' : 'We were looking into a problem'
  return ranked(
    make('unnamed-report', 6, 'attention', { title, detail: reportedSentence(report, context.at) }),
  )
}

function slowRank(context: Context): Ranked | null {
  const slow = context.input.services.filter((service) => service.state === 'slow')
  if (slow.length === 0) {
    return null
  }
  const names = joinNames(slow.map((service) => service.name))
  const pass = context.tense === 'present' ? 'still pass' : 'still passed'
  const detail = `${measuredSentence(slow, context.tense)} ${slow.length === 1 ? 'Its' : 'Their'} checks ${pass}.`
  const title = `${names} ${be(slow.length, context.tense)} slower than usual`
  return ranked(
    make(
      'slow',
      7,
      'attention',
      { title, detail },
      slow.map((service) => service.key),
    ),
  )
}

function maintenanceRank(context: Context): Ranked | null {
  const nameOf = (key: string, fallback: string) =>
    context.input.services.find((service) => service.key === key)?.name ?? fallback
  const leads: Lead[] = context.input.moment.windows.map((window) =>
    windowSentence(window, nameOf, context.at),
  )
  const reported = context.named.filter((entry) => entry.impact === 'maintenance')
  const byReport = new Map<ActiveReport, Named[]>()
  for (const entry of reported) {
    byReport.set(entry.report, [...(byReport.get(entry.report) ?? []), entry])
  }
  for (const [report, entries] of byReport) {
    leads.push({
      text: `${joinNames(entries.map((entry) => entry.name))}: “${report.title}”.`,
      leadsWithName: true,
    })
  }
  const [first] = leads
  if (first === undefined) {
    return null
  }
  const title =
    context.tense === 'present' ? 'Maintenance in progress' : 'Maintenance was in progress'
  const detail = [...leads.map((lead) => lead.text), checksKeepRunning(context.tense)].join(' ')
  const keys = [
    ...context.input.moment.windows.flatMap((window) =>
      window.endpoints.map((endpoint) => endpoint.key),
    ),
    ...reported.map((entry) => entry.key),
  ]
  return ranked(make('maintenance', 8, 'neutral', { title, detail }, keys), first.leadsWithName)
}

function workingRank(context: Context): Headline {
  const { services } = context.input
  const checked = services.filter((service) => service.hasChecks)
  const unchecked = services.filter((service) => !service.hasChecks)
  const present = context.tense === 'present'
  let detail: string
  if (checked.length === 1) {
    detail = present
      ? 'Its check passed on its latest run'
      : 'Its check had passed on its latest run'
  } else {
    detail = `All ${String(checked.length)} checks ${present ? '' : 'had '}passed on their latest run`
  }
  const usual = present && checked.every((service) => service.normal.kind === 'usual')
  detail += usual ? `, at ${checked.length === 1 ? 'its' : 'their'} usual speed.` : '.'
  if (unchecked.length > 0) {
    const has = unchecked.length === 1 ? 'has' : 'have'
    detail += ` ${joinNames(unchecked.map((service) => service.name))} ${present ? has : 'had'} no checks yet.`
  }
  const title = present ? 'Everything is working' : 'Everything was working'
  return make('working', 10, 'success', { title, detail })
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

/** Puts "As of 13:41 UTC (our newest check), " before a detail, keeping a leading name's capital. */
function withAsOf(result: Ranked, context: Context): Headline {
  const newest = context.input.newestCheckAt
  const chosen = result.found
  if (
    context.tense === 'past' ||
    newest === null ||
    chosen.detail === null ||
    !isStale(newest, context.at)
  ) {
    return chosen
  }
  const detail = result.leadsWithName ? chosen.detail : lowerFirst(chosen.detail)
  return { ...chosen, detail: asOfPrefix(newest, context.at) + detail }
}

function staleRank(context: Context): Headline | null {
  const newest = context.input.newestCheckAt
  if (context.tense === 'past' || newest === null || !isStale(newest, context.at)) {
    return null
  }
  const detail = `Our newest check finished ${relativeTime(newest, context.at)}, at ${utcClockNear(newest, context.at)}. Until then, every check passed.`
  return make('stale', 9, 'attention', { title: 'Status may be out of date', detail })
}

function noChecksRank(context: Context): Headline | null {
  if (context.input.services.some((service) => service.hasChecks)) {
    return null
  }
  return context.tense === 'present'
    ? make('no-checks', null, 'neutral', {
        title: 'No checks have run yet',
        detail: 'The first checks have not finished yet.',
      })
    : make('no-checks', null, 'neutral', {
        title: 'No checks had run yet',
        detail: 'The first checks had not finished yet.',
      })
}

/** The headline for a set of services at a moment. */
export function headline(input: HeadlineInput): Headline {
  if (!input.loaded) {
    return make('unavailable', 1, 'danger', {
      title: 'Status unavailable',
      detail: 'This page could not load the service status. Try again in a minute.',
    })
  }
  if (input.services.length === 0) {
    return make('nothing-configured', null, 'neutral', {
      title: 'No services are monitored on this page',
      detail: null,
    })
  }
  const context: Context = {
    input,
    tense: input.tense ?? 'present',
    at: input.moment.at,
    named: namedByReports(input),
  }
  const ranks = [
    () => reportRank(context, 'major'),
    () => failedRank(context),
    () => reportRank(context, 'partial'),
    () => reportRank(context, 'degraded'),
    () => unnamedRank(context),
    () => slowRank(context),
    () => maintenanceRank(context),
  ]
  for (const rank of ranks) {
    const found = rank()
    if (found !== null) {
      return withAsOf(found, context)
    }
  }
  return noChecksRank(context) ?? staleRank(context) ?? workingRank(context)
}

/**
 * The document title, which follows the H1: "Media failed its latest check ·
 * Pralvo status", or "2 Nov 13:50 UTC · Pralvo status" in time travel.
 */
export function documentTitle(
  found: Headline,
  siteName: string,
  travelAt: number | null = null,
): string {
  const lead = travelAt === null ? found.title : `${utcDay(travelAt)} ${utcClock(travelAt)}`
  return `${lead} · ${siteName}`
}
