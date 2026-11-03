// "Copy for a ticket" (spec section 7): plain text a reader can paste into a
// support ticket, naming the moment, the headline, each open report and a
// link back to the same view.

import type { Report } from '../../api/plugins/types'
import type { Headline } from '../headline/headline'
import { impactWord, stageWord, type ActiveReport } from '../notices/reports'
import { minuteMs, utcClockNear, utcDateTime } from '../time/format'

export interface TicketInput {
  /** The moment the text describes. */
  at: number
  /** The headline for that moment, in the past tense for time travel. */
  headline: Headline
  /** Reports open at the moment. */
  reports: ActiveReport[]
  /** The ?at= link to the same view. */
  link: string
  /** "Pralvo status" */
  siteName: string
}

/** "Report: “Images were slow to load” (Investigating, 13:44 UTC)." */
export function ticketReportLine(report: ActiveReport, at: number): string {
  const when = utcClockNear(report.latestAt, at)
  const stage = report.stage === null ? when : `${stageWord(report.stage)}, ${when}`
  return `Report: “${report.title}” (${stage}).`
}

/**
 * Pralvo status at 2 Nov 2026, 13:50 UTC:
 * Media had failed its latest check.
 * Its checks had failed since 13:40 UTC: answered with error 503; it needs a code below 500.
 * Report: “Images were slow to load” (Investigating, 13:44 UTC).
 * https://status.pralvo.com/?at=2026-11-02T13:50Z
 */
export function ticketText(input: TicketInput): string {
  const lines = [`${input.siteName} at ${utcDateTime(input.at)}:`, `${input.headline.title}.`]
  if (input.headline.detail !== null) {
    lines.push(input.headline.detail)
  }
  lines.push(...input.reports.map((report) => ticketReportLine(report, input.at)), input.link)
  return lines.join('\n')
}

export interface ReportTicketInput {
  report: Report
  /** The stage panel's sentence, from stageSentence(). */
  sentence: string
  /** When the text is copied. */
  now: number
  /** The report page's own address. */
  link: string
  /** "Pralvo status" */
  siteName: string
}

/**
 * "Copy for a ticket" on a report page, in the same shape as the home page's:
 * Pralvo status at 2 Nov 2026, 14:25 UTC:
 * Report: “Images were slow to load” (Resolved, 14:20 UTC).
 * Resolved on 2 Nov 2026 at 14:20 UTC, 36 minutes after it was published. Checks failed for 22 minutes in all.
 * Affected: Media (Degraded).
 * https://status.pralvo.com/reports/r1
 */
export function reportTicketText(input: ReportTicketInput): string {
  const { report } = input
  const latest = [...report.updates].sort((a, b) => b.at - a.at)[0]
  const line = ticketReportLine(
    {
      id: report.id,
      title: report.title,
      stage: report.stage,
      endpoints: report.endpoints,
      publishedAt: report.publishedAt,
      latestAt: latest?.at ?? report.updatedAt,
      latestMessage: latest?.message ?? null,
      updates: [],
    },
    input.now,
  )
  const lines = [`${input.siteName} at ${utcDateTime(input.now)}:`, line, input.sentence]
  if (report.endpoints.length > 0) {
    const affected = report.endpoints.map(
      (endpoint) => `${endpoint.name} (${impactWord(endpoint.impact)})`,
    )
    lines.push(`Affected: ${affected.join(', ')}.`)
  }
  lines.push(input.link)
  return lines.join('\n')
}

/**
 * The moment to open the status page at for "See the status page at ...": the
 * first minute at which the report was public. Time travel rounds down to the
 * minute and counts a report only from its publication, so a report published
 * at 13:44:30 is first seen at 13:45. An update dated before publication does
 * not move it earlier.
 */
export function firstSeenAt(report: Report): number {
  return Math.ceil(report.publishedAt / minuteMs) * minuteMs
}
