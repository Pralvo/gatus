// The story of one report, for /reports/:id (spec 4.5): the affected services'
// failures and every update, oldest first, with the facts for the stage panel
// and the "At a glance" ribbon. Only this page may say how long publication
// took after checks first failed.

import type { Report, ReportStage } from '../../api/plugins/types'
import type { StatusEvent } from '../../api/types'
import { stageWord } from '../notices/reports'
import { failureIntervals, type Interval } from '../record/intervals'
import { minuteMs, minutesText, utcClock, utcClockNear, utcDate } from '../time/format'

import { inTimeOrder, updateText, type StoryItem } from './story'

/** Failures that ended this long before publication still belong to the story. */
export const leadMs = 60 * minuteMs

export interface ReportStoryService {
  key: string
  name: string
  events?: StatusEvent[]
}

export interface ReportStory {
  items: StoryItem[]
  /** Failure periods of the affected services that touch the report's span. */
  failures: (Interval & { key: string })[]
  firstFailureAt: number | null
  /** Minutes when at least one affected service was failing, overlaps counted once. */
  failedMinutes: number
  /** Minutes from the first failure to publication; null when checks did not fail first. */
  publishedAfterMinutes: number | null
}

function unionMs(intervals: { start: number; end: number }[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  let total = 0
  let reach = Number.NEGATIVE_INFINITY
  for (const interval of sorted) {
    const start = Math.max(interval.start, reach)
    if (interval.end > start) {
      total += interval.end - start
    }
    reach = Math.max(reach, interval.end)
  }
  return total
}

function publishedAfter(minutes: number): string {
  return minutes < 1
    ? 'Published less than a minute after checks first failed.'
    : `Published ${minutesText(minutes)} after checks first failed.`
}

/** The story of a report. `now` closes the span of a report that is still open. */
export function reportStory(
  report: Report,
  services: ReportStoryService[],
  now: number,
): ReportStory {
  const end = report.resolvedAt ?? now
  const keys = new Set(report.endpoints.map((endpoint) => endpoint.key))
  const affected = services.filter((service) => keys.has(service.key))
  const failures = affected.flatMap((service) =>
    failureIntervals(service.events, end)
      .filter((interval) => interval.end >= report.publishedAt - leadMs)
      .map((interval) => ({ ...interval, key: service.key })),
  )
  const firstFailureAt =
    failures.length === 0 ? null : Math.min(...failures.map((interval) => interval.start))
  const publishedAfterMinutes =
    firstFailureAt === null || firstFailureAt > report.publishedAt
      ? null
      : Math.round((report.publishedAt - firstFailureAt) / minuteMs)
  const nameOf = (key: string) => affected.find((service) => service.key === key)?.name ?? key
  const measured: StoryItem[] = failures.flatMap((interval) => {
    const base = {
      source: 'Measured' as const,
      tone: 'danger' as const,
      key: interval.key,
      reportId: null,
    }
    const began = {
      ...base,
      at: interval.start,
      text: `Checks for ${nameOf(interval.key)} began failing.`,
    }
    return interval.open
      ? [began]
      : [
          began,
          {
            ...base,
            tone: 'success' as const,
            at: interval.end,
            text: `Checks for ${nameOf(interval.key)} passed again.`,
          },
        ]
  })
  const updates = [...report.updates].sort((a, b) => a.at - b.at)
  const reportBase = {
    source: 'Reported' as const,
    tone: 'attention' as const,
    key: null,
    reportId: report.id,
  }
  const reported: StoryItem[] =
    updates.length === 0
      ? [{ ...reportBase, at: report.publishedAt, text: `Published: “${report.title}”.` }]
      : updates.map((update) => ({
          ...reportBase,
          at: update.at,
          text: updateText(update.stage, update.message),
        }))
  const [first, ...rest] = reported
  const suffix = publishedAfterMinutes === null ? '' : ` ${publishedAfter(publishedAfterMinutes)}`
  const withSuffix = first === undefined ? rest : [{ ...first, text: first.text + suffix }, ...rest]
  return {
    items: inTimeOrder([...measured, ...withSuffix]),
    failures,
    firstFailureAt,
    failedMinutes: Math.round(unionMs(failures) / minuteMs),
    publishedAfterMinutes,
  }
}

const stageSentences = new Map<ReportStage, string>([
  ['investigating', 'Investigating. We are looking into this problem.'],
  ['identified', 'Identified. The cause is known.'],
  ['monitoring', 'Monitoring. A fix is in place and being watched.'],
])

/**
 * The stage panel: "Resolved on 2 Nov 2026 at 14:20 UTC, 36 minutes after it
 * was published. Checks failed for 22 minutes in all." or the open stage's
 * sentence. Pass null minutes while the services' events are unknown.
 */
export function stageSentence(report: Report, failedMinutes: number | null): string {
  if (report.stage !== 'resolved' || report.resolvedAt === undefined) {
    return stageSentences.get(report.stage) ?? stageWord(report.stage)
  }
  const after = minutesText((report.resolvedAt - report.publishedAt) / minuteMs)
  const resolved = `Resolved on ${utcDate(report.resolvedAt)} at ${utcClock(report.resolvedAt)}, ${after} after it was published.`
  if (failedMinutes === null) {
    return resolved
  }
  return failedMinutes === 0
    ? `${resolved} No checks failed.`
    : `${resolved} Checks failed for ${minutesText(failedMinutes)} in all.`
}

/**
 * The text list under the ribbon: "Failed checks (measured): 13:40 to 14:02
 * UTC, 22 minutes." and "Report open: 13:44 to 14:20 UTC. Stages: 1
 * Investigating 13:44, 2 Identified 13:51, ...".
 */
export function ribbonText(report: Report, story: ReportStory, now: number): string[] {
  const lines: string[] = []
  const end = report.resolvedAt ?? now
  const clock = (ms: number) => utcClockNear(ms, end).replace(' UTC', '')
  if (story.firstFailureAt !== null) {
    const last = Math.max(...story.failures.map((interval) => interval.end))
    const open = story.failures.some((interval) => interval.open)
    const until = open ? 'now' : `${clock(last)} UTC`
    lines.push(
      `Failed checks (measured): ${clock(story.firstFailureAt)} to ${until}, ${minutesText(story.failedMinutes)}.`,
    )
  }
  const stages = [...report.updates]
    .sort((a, b) => a.at - b.at)
    .map((update, index) => `${String(index + 1)} ${stageWord(update.stage)} ${clock(update.at)}`)
  const until = report.resolvedAt === undefined ? 'now' : `${clock(report.resolvedAt)} UTC`
  const stageList = stages.length === 0 ? '' : ` Stages: ${stages.join(', ')}.`
  lines.push(`Report open: ${clock(report.publishedAt)} to ${until}.${stageList}`)
  return lines
}
