// "Past notices" (spec 4.1): published reports and maintenance as they stood
// at the end moment. A report sits on the moment it last changed by then, with
// the stage it had then. Upcoming maintenance is left out: the page says what
// is and what was, never what is next. Grouping by month, filters and search
// are in domain/browse.

import type { MaintenanceWindow, Report, ReportStage } from '../../api/plugins/types'

import { stageWord } from './reports'

export type NoticeItem =
  | {
      kind: 'report'
      id: string
      title: string
      /** The stage by the end moment; null when no update by then says it. */
      stage: ReportStage | null
      at: number
    }
  | {
      kind: 'maintenance'
      title: string
      state: 'in-progress' | 'finished'
      at: number
      end: number
    }

export interface PastNoticesInput {
  reports: Report[]
  windows: MaintenanceWindow[]
  /** Now, or the time-travel moment: nothing after it is shown. */
  end: number
}

/** A report as it stood at the end moment, or null if it was not yet published. */
function reportItem(report: Report, end: number): NoticeItem | null {
  if (report.publishedAt > end) {
    return null
  }
  const known = report.updates.filter((update) => update.at <= end)
  const latest = known.reduce<(typeof known)[number] | undefined>(
    (found, update) => (found === undefined || update.at > found.at ? update : found),
    undefined,
  )
  let said: { at: number; stage: ReportStage | null } = { at: report.publishedAt, stage: null }
  if (latest !== undefined) {
    said = latest
  } else if (report.updatedAt <= end) {
    said = { at: report.updatedAt, stage: report.stage }
  }
  const resolved = report.resolvedAt !== undefined && report.resolvedAt <= end
  const at = resolved ? Math.max(said.at, report.resolvedAt ?? said.at) : said.at
  const stage = resolved ? 'resolved' : said.stage
  return { kind: 'report', id: report.id, title: report.title, stage, at }
}

/** A window that had begun by the end moment; in progress sits on its start, finished on its end. */
function windowItem(window: MaintenanceWindow, end: number): NoticeItem | null {
  if (window.start > end) {
    return null
  }
  const finished = window.end <= end
  return {
    kind: 'maintenance',
    title: window.title,
    state: finished ? 'finished' : 'in-progress',
    at: finished ? window.end : window.start,
    end: window.end,
  }
}

/** Every notice up to `end`, newest first. */
export function noticeItems(input: PastNoticesInput): NoticeItem[] {
  return [
    ...input.reports.map((report) => reportItem(report, input.end)),
    ...input.windows.map((window) => windowItem(window, input.end)),
  ]
    .filter((item): item is NoticeItem => item !== null && item.at <= input.end)
    .sort((a, b) => b.at - a.at)
}

/** The label beside a notice: "Resolved", "Investigating", "Maintenance finished", ... */
export function noticeLabel(item: NoticeItem): string {
  if (item.kind === 'maintenance') {
    return item.state === 'finished' ? 'Maintenance finished' : 'Maintenance in progress'
  }
  return item.stage === null ? 'Published' : stageWord(item.stage)
}
