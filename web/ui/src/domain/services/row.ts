// The words of the Services section (spec 4.1): each group's sentence and
// each row's second line, which gives the trend and why when failing and the
// comparison with normal otherwise.

import { whyText } from '../conditions/why'
import type { ServiceStatus } from '../status/service'
import { comparisonText, trendText } from '../status/trend'
import { relativeTime, utcClockNear } from '../time/format'

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

/** "2 services, all working", or the services that are not: "Media: check failed; Blog: slower than usual". */
export function groupSentence(services: ServiceStatus[]): string {
  const problems = services.filter((service) => service.state !== 'working')
  if (problems.length === 0) {
    return services.length === 1
      ? '1 service, working'
      : `${String(services.length)} services, all working`
  }
  return problems.map((service) => `${service.name}: ${lowerFirst(service.word)}`).join('; ')
}

export interface RowLineOptions {
  /** Now, or the time-travel moment. */
  reference: number
  /** The whole page may be out of date (rank 9). */
  stale: boolean
  /** In time travel: whether this service still has check details at the moment. */
  kept?: boolean
}

export const notKeptLine = 'Check details for this time are no longer kept.'

function failingLine(service: ServiceStatus, options: RowLineOptions): string {
  const why = service.why.length === 0 ? '' : `: ${whyText(service.why)}`
  if (service.trend.kind === 'failing') {
    return `${trendText(service.trend, options.reference)}${why}.`
  }
  const since =
    service.failingSince === null
      ? ''
      : ` since ${utcClockNear(service.failingSince, options.reference)}`
  const kept = options.kept === false ? ` ${notKeptLine}` : ''
  return `Failing${since}${why}.${kept}`
}

function passingLine(service: ServiceStatus, reference: number): string {
  if (service.state === 'maintenance') {
    const title = service.maintenance?.title ?? service.reported?.report.title ?? 'Maintenance'
    return `“${title}”. Checks keep running, so a failure still shows.`
  }
  const comparison = comparisonText(service.normal)
  return service.trend.kind === 'recovering' || service.trend.kind === 'unsteady'
    ? `${trendText(service.trend, reference)}. ${comparison}`
    : comparison
}

/** The second line of a service row. */
export function rowLine(service: ServiceStatus, options: RowLineOptions): string {
  const { reference } = options
  if (service.failing) {
    return failingLine(service, options)
  }
  if (options.kept === false) {
    return notKeptLine
  }
  if (!service.hasChecks || service.latestAt === null) {
    return 'The first check has not finished yet.'
  }
  if (options.stale || service.state === 'late') {
    return `Last check ${relativeTime(service.latestAt, reference)}, at ${utcClockNear(service.latestAt, reference)}.`
  }
  return passingLine(service, reference)
}
