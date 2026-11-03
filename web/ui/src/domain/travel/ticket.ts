// "Copy for a ticket" (spec section 7): plain text a reader can paste into a
// support ticket, naming the moment, the headline, each open report and a
// link back to the same view.

import type { Headline } from '../headline/headline'
import { stageWord, type ActiveReport } from '../notices/reports'
import { utcClockNear, utcDateTime } from '../time/format'

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
