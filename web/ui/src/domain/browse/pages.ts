// Paging through /api/v1/reports for a month view. The server lists unresolved
// reports first, then the rest by most recent change, so once the last loaded
// report is resolved and older than the first month shown, later pages hold
// nothing that view needs.

import type { Report, ReportPage } from '../../api/plugins/types'
import { groupReports, isResolved } from '../notices/reports'

import { searchWords, titleHas, type NoticeFilter } from './filter'
import { groupByMonth, type Month } from './months'

/** A guard against a server that always says there is more. */
export const maxReportPages = 30

/** Whether the next page is needed to show everything from `from`. */
export function needOlderPage(pages: ReportPage[], from: number): boolean {
  const last = pages.at(-1)
  if (last === undefined || !last.more || pages.length >= maxReportPages) {
    return false
  }
  const oldest = last.reports.at(-1)
  if (oldest === undefined) {
    // An empty page that claims more: stop rather than ask forever.
    return false
  }
  return !isResolved(oldest) || oldest.updatedAt >= from
}

/** Reports by id, the first list winning: it is newer, or has every update. */
export function mergeReports(first: Report[], rest: Report[]): Report[] {
  const seen = new Set(first.map((report) => report.id))
  return [...first, ...rest.filter((report) => !seen.has(report.id))]
}

/** Whether older entries may exist than those shown from `from`. */
export function olderMayExist(ats: number[], from: number, more: boolean): boolean {
  return more || ats.some((at) => at < from)
}

export interface ReportBrowse {
  /** Unresolved reports that match, whatever their age, most recently changed first. */
  active: Report[]
  /** Resolved reports that match and changed from `from`, by month. */
  past: Month<Report>[]
  /** Older resolved reports may match: offer "Show older reports". */
  older: boolean
}

/** The reports list for a state and search, past reports from `from` on. */
export function browseReports(
  reports: Report[],
  filter: NoticeFilter,
  from: number,
  more: boolean,
): ReportBrowse {
  const words = searchWords(filter.search)
  const { active, past } = groupReports(reports.filter((report) => titleHas(report.title, words)))
  const resolved = filter.state === 'unresolved' ? [] : past
  return {
    active: filter.state === 'resolved' ? [] : active,
    past: groupByMonth(
      resolved.filter((report) => report.updatedAt >= from),
      (report) => report.updatedAt,
    ),
    older:
      filter.state !== 'unresolved' &&
      olderMayExist(
        resolved.map((report) => report.updatedAt),
        from,
        more,
      ),
  }
}
