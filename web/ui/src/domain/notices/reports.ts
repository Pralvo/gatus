// Which published reports were open at a moment, and what they said then
// (spec section 6 and 9.3). "Now" is just the moment the caller passes.

import type {
  Impact,
  Report,
  ReportEndpoint,
  ReportStage,
  ReportUpdate,
} from '../../api/plugins/types'

/** A report as it stood at a moment. */
export interface ActiveReport {
  id: string
  /** The current title: the API keeps no older wording. */
  title: string
  /** The stage at the moment; null when the updates that would say it are not loaded. */
  stage: ReportStage | null
  endpoints: ReportEndpoint[]
  publishedAt: number
  /** When it last spoke at or before the moment: its latest update, or its publication. */
  latestAt: number
  latestMessage: string | null
  /** Updates at or before the moment, oldest first. */
  updates: ReportUpdate[]
}

const impactOrder: Impact[] = ['major', 'partial', 'degraded', 'maintenance']

/** Lower is worse: major 0, partial 1, degraded 2, maintenance 3. */
export function impactRank(impact: Impact): number {
  return impactOrder.indexOf(impact)
}

function asAt(report: Report, moment: number): ActiveReport | null {
  if (
    report.publishedAt > moment ||
    (report.resolvedAt !== undefined && report.resolvedAt <= moment)
  ) {
    return null
  }
  const updates = report.updates.filter((update) => update.at <= moment).sort((a, b) => a.at - b.at)
  const latest = updates.at(-1)
  const stage = latest?.stage ?? (report.updatedAt <= moment ? report.stage : null)
  if (stage === 'resolved') {
    return null
  }
  return {
    id: report.id,
    title: report.title,
    stage,
    endpoints: report.endpoints,
    publishedAt: report.publishedAt,
    latestAt: latest?.at ?? report.publishedAt,
    latestMessage: latest?.message ?? null,
    updates,
  }
}

/**
 * The reports open at a moment: published at or before it, and not resolved by
 * then. Its stage and text come from its latest update at or before the moment.
 * Most recently updated first.
 */
export function reportsAt(reports: Report[], moment: number): ActiveReport[] {
  return reports
    .map((report) => asAt(report, moment))
    .filter((report) => report !== null)
    .sort((a, b) => b.latestAt - a.latestAt)
}

export interface ReportedImpact {
  impact: Impact
  report: ActiveReport
}

/** The worst impact any open report gives a service, with the report that gives it. */
export function impactOn(reports: ActiveReport[], key: string): ReportedImpact | null {
  let worst: ReportedImpact | null = null
  for (const report of reports) {
    for (const endpoint of report.endpoints) {
      if (
        endpoint.key === key &&
        (worst === null || impactRank(endpoint.impact) < impactRank(worst.impact))
      ) {
        worst = { impact: endpoint.impact, report }
      }
    }
  }
  return worst
}

/** "Investigating", "Identified", "Monitoring", "Resolved". */
export function stageWord(stage: ReportStage): string {
  return `${stage.charAt(0).toUpperCase()}${stage.slice(1)}`
}
