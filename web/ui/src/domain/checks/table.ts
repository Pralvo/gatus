// "Recent checks" on the service page (spec 4.2 item 6): a table of the newest
// checks, 50 to a page, read from Gatus's own result pages. Gatus sends no
// total, so an older page exists only when this page is full and the server
// keeps more results than the pages so far hold.

import type { Result } from '../../api/types'
import { inOrder, timeOf } from '../status/trend'

import { slotDetails, type SlotDetails } from './strip'

export const checksPageSize = 50

export interface CheckRow extends SlotDetails {
  /** When the check ran, for the row's key and the hover title. */
  at: number
}

/** The page's checks, newest first, as table rows. Results after `until` are left out. */
export function checkRows(results: Result[], reference: number, until = reference): CheckRow[] {
  return inOrder(results)
    .filter((result) => timeOf(result) <= until)
    .reverse()
    .flatMap((result) => {
      const details = slotDetails({ kind: result.success ? 'passed' : 'failed', result }, reference)
      return details === null ? [] : [{ ...details, at: timeOf(result) }]
    })
}

/** Whether "Older checks" can lead anywhere. */
export function hasOlderPage(page: number, count: number, keptResults: number): boolean {
  return count >= checksPageSize && page * checksPageSize < keptResults
}

/** "Checks 51 to 100, newest first." */
export function pageCaption(page: number, count: number): string {
  if (count === 0) {
    return page === 1 ? 'No checks are kept yet.' : 'No older checks are kept.'
  }
  const first = (page - 1) * checksPageSize + 1
  return count === 1
    ? `Check ${String(first)}, the newest on this page.`
    : `Checks ${String(first)} to ${String(first + count - 1)}, newest first.`
}
