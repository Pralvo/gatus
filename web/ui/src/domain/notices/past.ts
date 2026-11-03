// "Past notices" under the track record (spec 4.1): published reports and
// maintenance of the last 14 days, newest first, one list per UTC day. A
// report sits on the day it last changed by the end moment, with the stage it
// had then. Upcoming maintenance is left out: the page says what is and what
// was, never what is next.

import type { MaintenanceWindow, Report, ReportStage } from '../../api/plugins/types'
import { dayMs, startOfUtcDay } from '../time/format'

import { stageWord } from './reports'

export const pastNoticesDays = 14
export const noNoticesText = 'No notices'

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

export interface NoticeDay {
  /** Midnight UTC. */
  start: number
  /** Newest first. */
  items: NoticeItem[]
}

export interface PastNoticesInput {
  reports: Report[]
  windows: MaintenanceWindow[]
  /** Now, or the time-travel moment: nothing after it is shown. */
  end: number
  /** How many days to list, today included. */
  days?: number
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
function windowItem(window: MaintenanceWindow, end: number, firstDay: number): NoticeItem | null {
  if (window.start > end) {
    return null
  }
  const finished = window.end <= end
  return {
    kind: 'maintenance',
    title: window.title,
    state: finished ? 'finished' : 'in-progress',
    at: finished ? window.end : Math.max(window.start, firstDay),
    end: window.end,
  }
}

/** The notices of the last days up to `end`, newest day first. Days without notices are kept, empty. */
export function pastNotices(input: PastNoticesInput): NoticeDay[] {
  const count = Math.max(1, input.days ?? pastNoticesDays)
  const lastDay = startOfUtcDay(input.end)
  const firstDay = lastDay - (count - 1) * dayMs
  const items = [
    ...input.reports.map((report) => reportItem(report, input.end)),
    ...input.windows.map((window) => windowItem(window, input.end, firstDay)),
  ].filter(
    (item): item is NoticeItem => item !== null && item.at >= firstDay && item.at <= input.end,
  )
  return Array.from({ length: count }, (_, index) => {
    const start = lastDay - index * dayMs
    return {
      start,
      items: items.filter((item) => startOfUtcDay(item.at) === start).sort((a, b) => b.at - a.at),
    }
  })
}

/** The label beside a notice: "Resolved", "Investigating", "Maintenance finished", ... */
export function noticeLabel(item: NoticeItem): string {
  if (item.kind === 'maintenance') {
    return item.state === 'finished' ? 'Maintenance finished' : 'Maintenance in progress'
  }
  return item.stage === null ? 'Published' : stageWord(item.stage)
}
