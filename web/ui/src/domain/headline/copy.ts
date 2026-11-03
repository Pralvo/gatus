// The sentences of the headline (spec section 6), in the present tense for now
// and the past perfect for time travel. Every template is written out in both
// tenses, rather than rewriting "is" to "was", because service names and report
// titles are server text and must never be edited.

import type { MaintenanceWindow } from '../../api/plugins/types'
import { whyText } from '../conditions/why'
import type { ActiveReport } from '../notices/reports'
import type { ServiceStatus } from '../status/service'
import { speedPair } from '../status/trend'
import { utcClockNear } from '../time/format'

export type Tense = 'present' | 'past'

/** A sentence and whether it opens with a name, which must keep its capital. */
export interface Lead {
  text: string
  leadsWithName: boolean
}

/** One name, "Website and Blog", or a count: "3 services". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? ''
  }
  if (names.length === 2) {
    return `${names[0] ?? ''} and ${names[1] ?? ''}`
  }
  return `${String(names.length)} services`
}

/** "is" or "are", "was" or "were". */
export function be(count: number, tense: Tense): string {
  if (tense === 'present') {
    return count === 1 ? 'is' : 'are'
  }
  return count === 1 ? 'was' : 'were'
}

/** "Reported at 13:51 UTC: “The blog is slow to load”." */
export function reportedSentence(report: ActiveReport, reference: number): string {
  return `Reported at ${utcClockNear(report.latestAt, reference)}: “${report.title}”.`
}

/** The failure sentence for one service, for rank 3. */
export function oneFailing(service: ServiceStatus, tense: Tense, reference: number): string {
  const why = whyText(service.why)
  const since = service.failingSince === null ? null : utcClockNear(service.failingSince, reference)
  if (tense === 'past') {
    return since === null
      ? `Its latest check had failed: ${why}.`
      : `Its checks had failed since ${since}: ${why}.`
  }
  if (service.failRun === 1 || since === null) {
    const latest =
      service.latestAt === null ? '' : `, at ${utcClockNear(service.latestAt, reference)}`
    return `Its latest check${latest}, failed: ${why}.`
  }
  return `It has failed its last ${String(service.failRun)} checks, since ${since}: ${why}.`
}

function latestStart(services: ServiceStatus[]): number | null {
  const starts = services.map((service) => service.failingSince).filter((time) => time !== null)
  return starts.length === 0 ? null : Math.max(...starts)
}

/** The shared reason of several failing services, or nothing when they differ. */
function sharedWhy(services: ServiceStatus[]): string {
  const reasons = new Set(services.map((service) => whyText(service.why)))
  const [only] = [...reasons]
  return reasons.size === 1 && only !== undefined ? `: ${only}` : ''
}

/** The failure sentence for two or more services, for rank 3. */
export function severalFailing(services: ServiceStatus[], tense: Tense, reference: number): Lead {
  const start = latestStart(services)
  const since = start === null ? '' : `, since ${utcClockNear(start, reference)}`
  const why = sharedWhy(services)
  if (tense === 'past') {
    return { text: `Their checks had failed${since}${why}.`, leadsWithName: false }
  }
  const runs = services.map((service) => service.failRun ?? 1)
  const run = Math.min(...runs)
  const names = joinNames(services.map((service) => service.name))
  const text =
    run <= 1
      ? `${names} failed their latest check${why}.`
      : `${names} have failed their last ${String(run)} checks${since}${why}.`
  return { text, leadsWithName: true }
}

/** The sentence for when every service failed, for rank 3. */
export function allFailing(services: ServiceStatus[], tense: Tense, reference: number): string {
  const start = latestStart(services)
  const since = start === null ? '' : `, since ${utcClockNear(start, reference)}`
  return tense === 'present'
    ? `Every check failed on its latest run${since}. This can also mean our monitor cannot reach the internet.`
    : `Every check had failed on its latest run${since}. This can also mean our monitor could not reach the internet.`
}

/** "Its last 3 checks failed, since 13:47 UTC." after a reported outage, for rank 2. */
export function alsoFailing(service: ServiceStatus, tense: Tense, reference: number): string {
  const since = service.failingSince === null ? null : utcClockNear(service.failingSince, reference)
  if (tense === 'past') {
    return since === null ? 'Its latest check had failed.' : `Its checks had failed since ${since}.`
  }
  if (service.failRun === 1 || since === null) {
    const latest =
      service.latestAt === null ? '' : `, at ${utcClockNear(service.latestAt, reference)}`
    return `Its latest check${latest}, failed.`
  }
  return `Its last ${String(service.failRun)} checks failed, since ${since}.`
}

/** "Measured: 1.2 s now, 70 ms usually." or, for several, "Measured: Blog 1.2 s now, ...; Media ...". */
export function measuredSentence(services: ServiceStatus[], tense: Tense): string {
  const word = tense === 'present' ? 'now' : 'then'
  const [first] = services
  if (services.length === 1 && first !== undefined) {
    return `Measured: ${speedPair(first.normal, word)}.`
  }
  const pairs = services.map((service) => `${service.name} ${speedPair(service.normal, word)}`)
  return `Measured: ${pairs.join('; ')}.`
}

/** "Database: “Database upgrade”, until 15:00 UTC." for one window. */
export function windowSentence(
  window: MaintenanceWindow,
  nameOf: (key: string, fallback: string) => string,
  reference: number,
): Lead {
  const covered =
    window.endpoints.length === 0
      ? 'All services'
      : joinNames(window.endpoints.map((endpoint) => nameOf(endpoint.key, endpoint.name)))
  return {
    text: `${covered}: “${window.title}”, until ${utcClockNear(window.end, reference)}.`,
    leadsWithName: window.endpoints.length > 0,
  }
}

/** The closing sentence of the maintenance detail. */
export function checksKeepRunning(tense: Tense): string {
  return tense === 'present'
    ? 'Checks keep running, so a failure still shows.'
    : 'Checks kept running, so a failure would still show.'
}
