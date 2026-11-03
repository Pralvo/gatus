// "What is happening" on the home page (spec 4.1): one list, oldest first,
// joining what the checks measured, what reports said and scheduled
// maintenance, each with its source. It never says how fast Pralvo responded
// (spec section 0, decision 3); that belongs to report pages only.

import type { ReportStage } from '../../api/plugins/types'
import { whyText } from '../conditions/why'
import { stageWord, type ActiveReport } from '../notices/reports'
import type { Moment, ServiceStatus, Tone } from '../status/service'
import { isSlow, speedPair } from '../status/trend'
import { utcClockNear } from '../time/format'

export type StorySource = 'Measured' | 'Reported' | 'Scheduled'

export interface StoryItem {
  at: number
  source: StorySource
  tone: Tone
  text: string
  /** The service the item is about, when it is about one. */
  key: string | null
  /** The report the item comes from, for a link. */
  reportId: string | null
}

/** Sorts oldest first, keeping the given order for equal times. */
export function inTimeOrder(items: StoryItem[]): StoryItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.at - b.item.at || a.index - b.index)
    .map(({ item }) => item)
}

/** "Identified: “Blog pages take over a second to load.”" */
export function updateText(stage: ReportStage, message: string): string {
  return `${stageWord(stage)}: “${message}”`
}

function failureItems(service: ServiceStatus): StoryItem[] {
  const why = whyText(service.why)
  const base = {
    source: 'Measured' as const,
    tone: 'danger' as const,
    key: service.key,
    reportId: null,
  }
  const run = service.failRun ?? 0
  const since = service.failingSince ?? service.latestAt
  if (since === null) {
    return []
  }
  if (run <= 1 || service.latestAt === null) {
    return [{ ...base, at: since, text: `Checks for ${service.name} began failing: ${why}.` }]
  }
  return [
    { ...base, at: since, text: `Checks for ${service.name} began failing.` },
    {
      ...base,
      at: service.latestAt,
      text: `${service.name} failed again (${String(run)} failed checks in a row): ${why}.`,
    },
  ]
}

function slowItem(service: ServiceStatus): StoryItem | null {
  if (!isSlow(service.normal) || service.latestAt === null || service.failing) {
    return null
  }
  const noReport = service.reported === null ? ' No report has been published.' : ''
  return {
    at: service.latestAt,
    source: 'Measured',
    tone: 'attention',
    text: `${service.name} answers are slower than usual: ${speedPair(service.normal)}.${noReport}`,
    key: service.key,
    reportId: null,
  }
}

function reportItems(report: ActiveReport): StoryItem[] {
  const tone: Tone = report.endpoints.some((endpoint) => endpoint.impact === 'major')
    ? 'danger'
    : 'attention'
  const base = { source: 'Reported' as const, tone, key: null, reportId: report.id }
  if (report.updates.length === 0) {
    return [{ ...base, at: report.publishedAt, text: `Published: “${report.title}”.` }]
  }
  return report.updates.map((update) => ({
    ...base,
    at: update.at,
    text: updateText(update.stage, update.message),
  }))
}

function windowItems(moment: Moment, services: ServiceStatus[]): StoryItem[] {
  return moment.windows.map((window) => {
    const names = window.endpoints.map(
      (endpoint) => services.find((service) => service.key === endpoint.key)?.name ?? endpoint.name,
    )
    const covered = names.length === 0 ? 'all services' : names.join(', ')
    return {
      at: window.start,
      source: 'Scheduled',
      tone: 'neutral',
      text: `Maintenance began on ${covered}: “${window.title}”, until ${utcClockNear(window.end, moment.at)}.`,
      key: window.endpoints.length === 1 ? (window.endpoints[0]?.key ?? null) : null,
      reportId: null,
    }
  })
}

/**
 * The home story at a moment. Empty when everything is normal, which hides
 * the section: no failing or slow service, no open report, no maintenance.
 */
export function homeStory(services: ServiceStatus[], moment: Moment): StoryItem[] {
  const items = [
    ...services.filter((service) => service.failing).flatMap(failureItems),
    ...services.map(slowItem).filter((item) => item !== null),
    ...moment.reports.flatMap(reportItems),
    ...windowItems(moment, services),
  ]
  return inTimeOrder(items)
}
