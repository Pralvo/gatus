// The service page's answer panel (spec 4.2 item 2): the detail under the
// status word. Failing: "Failed its last 3 checks, since 13:41 UTC. Why:
// answered with error 503; it needs a code below 500." Passing: "The latest
// check passed at 14:01 UTC. Steady." Reports, maintenance, speed and
// staleness add their own sentences, built from the headline's copy so the
// two pages never word the same fact differently.

import { whyText } from '../conditions/why'
import {
  alsoFailing,
  checksKeepRunning,
  measuredSentence,
  reportedSentence,
  type Tense,
} from '../headline/copy'
import { notKeptLine } from '../services/row'
import type { ServiceStatus } from '../status/service'
import { isSlow, trendText } from '../status/trend'
import { relativeTime, utcClockNear } from '../time/format'

export interface DetailOptions {
  /** Now, or the time-travel moment. */
  reference: number
  /** The whole monitor may be out of date (its newest check is over 15 minutes old). */
  stale: boolean
  /** "past" in time travel. */
  tense?: Tense
  /** In time travel: whether check details are still kept for the moment. */
  kept?: boolean
}

function whySentence(service: ServiceStatus): string {
  return service.why.length === 0 ? '' : ` Why: ${whyText(service.why)}.`
}

/** "Failed its last 3 checks, since 13:41 UTC. Why: ..." */
function failingDetail(service: ServiceStatus, options: DetailOptions): string {
  const { reference } = options
  if (service.trend.kind === 'failing') {
    return `${trendText(service.trend, reference)}.${whySentence(service)}`
  }
  // Time travel without kept results: the record says it was failing, and since when.
  const since =
    service.failingSince === null ? '' : ` since ${utcClockNear(service.failingSince, reference)}`
  const verb = options.tense === 'past' ? 'Had been failing' : 'Failing'
  const kept = options.kept === false ? ` ${notKeptLine}` : ''
  return `${verb}${since}.${whySentence(service)}${kept}`
}

/** "The latest check passed at 14:01 UTC. Steady." */
function passingDetail(service: ServiceStatus, options: DetailOptions): string {
  const { reference } = options
  if (options.kept === false) {
    return `By the record, its checks were passing. ${notKeptLine}`
  }
  if (service.latestAt === null) {
    return options.tense === 'past'
      ? 'The first check had not finished yet.'
      : 'The first check has not finished yet.'
  }
  if (options.stale || service.state === 'late') {
    return `Last check ${relativeTime(service.latestAt, reference)}, at ${utcClockNear(service.latestAt, reference)}.`
  }
  const passed = options.tense === 'past' ? 'had passed' : 'passed'
  return `The latest check ${passed} at ${utcClockNear(service.latestAt, reference)}. ${trendText(service.trend, reference)}.`
}

/** The reported, scheduled or measured-slow sentence that comes before the checks. */
function leadSentence(service: ServiceStatus, options: DetailOptions): string | null {
  const tense = options.tense ?? 'present'
  if (service.state === 'maintenance') {
    const title = service.maintenance?.title ?? service.reported?.report.title ?? 'Maintenance'
    return `“${title}”. ${checksKeepRunning(tense)}`
  }
  if (service.reported !== null && service.state !== 'failed') {
    const speed =
      service.state === 'degraded' && isSlow(service.normal)
        ? ` ${measuredSentence([service], tense)}`
        : ''
    return `${reportedSentence(service.reported.report, options.reference)}${speed}`
  }
  if (service.state === 'slow') {
    const still = tense === 'present' ? 'Its checks still pass.' : 'Its checks still passed.'
    return `${measuredSentence([service], tense)} ${still}`
  }
  return null
}

/** The detail line under the service's status word. */
export function serviceDetail(service: ServiceStatus, options: DetailOptions): string {
  const tense = options.tense ?? 'present'
  const lead = leadSentence(service, options)
  if (service.failing) {
    // A reported outage names the report first, then what the checks say.
    if (lead !== null && service.state === 'down') {
      return `${lead} ${alsoFailing(service, tense, options.reference)}${whySentence(service)}`
    }
    return failingDetail(service, options)
  }
  if (lead !== null) {
    return lead
  }
  return passingDetail(service, options)
}
