// The admin's public preview and "From the checks" (design spec section 4.6).
// The preview puts the report being edited, with its unsaved choices, beside
// the reports and maintenance already public, and asks headline() what the
// status page would say. It never words a headline itself.

import type { Affected } from '../../admin/api/types'
import type { Impact, MaintenanceWindow, Report, ReportStage } from '../../api/plugins/types'
import { newestCheckAt } from '../freshness/staleness'
import { headline, type Headline } from '../headline/headline'
import { measure, momentAt, serviceStatuses, type ServiceInput, type Tone } from '../status/service'
import { utcClockNear } from '../time/format'

/** The report being edited, as the editor holds it. */
export interface DraftReport {
  id: string
  title: string
  stage: ReportStage
  endpoints: readonly Affected[]
  updates: readonly { at: number; stage: ReportStage; message: string }[]
  /** When it was published; null for a draft, which the preview treats as published now. */
  publishedAt: number | null
}

export interface PreviewInput {
  /** False when the service checks could not be loaded. */
  loaded: boolean
  services: ServiceInput[]
  /** Reports already public; the edited report's public copy, if any, is replaced. */
  reports: Report[]
  windows: MaintenanceWindow[]
  draft: DraftReport
  now: number
  hasProbe?: (key: string) => boolean
}

export interface PreviewWord {
  key: string
  name: string
  word: string
  tone: Tone
}

export interface Preview {
  headline: Headline
  /** Each service the report names, with the word its row would show. */
  affected: PreviewWord[]
  /** False when the report would not count, as when it is resolved. */
  counts: boolean
}

const reportedWords: Record<Impact, { word: string; tone: Tone }> = {
  major: { word: 'Down', tone: 'danger' },
  partial: { word: 'Partly down', tone: 'severe' },
  degraded: { word: 'Degraded', tone: 'attention' },
  maintenance: { word: 'Maintenance', tone: 'neutral' },
}

function asPublic(draft: DraftReport, services: ServiceInput[], now: number): Report {
  const names = new Map(services.map((service) => [service.key, service.name]))
  return {
    id: draft.id,
    title: draft.title,
    stage: draft.stage,
    endpoints: draft.endpoints.map((entry) => ({
      key: entry.key,
      name: names.get(entry.key) ?? entry.key,
      impact: entry.impact,
    })),
    updates: draft.updates
      .map((update) => ({ stage: update.stage, at: update.at, message: update.message }))
      .sort((a, b) => b.at - a.at),
    publishedAt: draft.publishedAt ?? now,
    updatedAt: now,
  }
}

/** What visitors would read if the report were public with the current choices. */
export function previewHeadline(input: PreviewInput): Preview {
  const report = asPublic(input.draft, input.services, input.now)
  const others = input.reports.filter((candidate) => candidate.id !== input.draft.id)
  const moment = momentAt(input.now, [...others, report], input.windows)
  const statuses = serviceStatuses(input.services, moment)
  const found = headline({
    loaded: input.loaded,
    services: statuses,
    moment,
    newestCheckAt: newestCheckAt(input.services),
    ...(input.hasProbe === undefined ? {} : { hasProbe: input.hasProbe }),
  })
  const affected = report.endpoints.map((entry) => {
    const status = statuses.find((candidate) => candidate.key === entry.key)
    const fallback = reportedWords[entry.impact]
    return {
      key: entry.key,
      name: entry.name,
      word: status?.word ?? fallback.word,
      tone: status?.tone ?? fallback.tone,
    }
  })
  return {
    headline: found,
    affected,
    counts: moment.reports.some((candidate) => candidate.id === input.draft.id),
  }
}

export interface Suggestion {
  key: string
  name: string
  /** "Media has failed its last 3 checks, since 13:41 UTC." */
  sentence: string
}

/** Services whose latest check failed and that the report does not name yet. */
export function checkSuggestions(
  services: ServiceInput[],
  named: readonly Affected[],
  now: number,
): Suggestion[] {
  return services.flatMap((service) => {
    const measured = measure(service, now)
    if (!measured.failing || named.some((entry) => entry.key === service.key)) {
      return []
    }
    const run = measured.failRun ?? 1
    const since = measured.failingSince
    const latest = measured.latestAt
    let sentence = `${service.name} failed its latest check.`
    if (run > 1 && since !== null) {
      sentence = `${service.name} has failed its last ${String(run)} checks, since ${utcClockNear(since, now)}.`
    } else if (latest !== null) {
      sentence = `${service.name} failed its latest check, at ${utcClockNear(latest, now)}.`
    }
    return [{ key: service.key, name: service.name, sentence }]
  })
}
