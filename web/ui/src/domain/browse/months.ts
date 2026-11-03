// Calendar months in UTC, for listing notices month by month, newest first.
// Only days that have something are listed.

import { startOfUtcDay } from '../time/format'

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Midnight UTC on the first of the month that holds `ms`. */
export function startOfUtcMonth(ms: number): number {
  const date = new Date(ms)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

/** The first moment shown when `months` months are shown up to `end`, its own month included. */
export function shownFrom(end: number, months: number): number {
  const date = new Date(end)
  const back = Math.max(1, Math.floor(months)) - 1
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back, 1)
}

/** "November 2026". */
export function utcMonth(ms: number): string {
  const date = new Date(ms)
  return `${monthNames[date.getUTCMonth()] ?? ''} ${String(date.getUTCFullYear())}`
}

export interface Day<T> {
  /** Midnight UTC. */
  start: number
  /** Newest first. */
  entries: T[]
}

export interface Month<T> {
  /** Midnight UTC on the first. */
  start: number
  /** Newest first; a day without entries is not listed. */
  days: Day<T>[]
}

/** Entries by UTC month and day, newest first at every level. */
export function groupByMonth<T>(entries: T[], atOf: (entry: T) => number): Month<T>[] {
  const sorted = [...entries].sort((a, b) => atOf(b) - atOf(a))
  const months: Month<T>[] = []
  for (const entry of sorted) {
    const at = atOf(entry)
    const monthStart = startOfUtcMonth(at)
    const dayStart = startOfUtcDay(at)
    let month = months.at(-1)
    if (month?.start !== monthStart) {
      month = { start: monthStart, days: [] }
      months.push(month)
    }
    let day = month.days.at(-1)
    if (day?.start !== dayStart) {
      day = { start: dayStart, entries: [] }
      month.days.push(day)
    }
    day.entries.push(entry)
  }
  return months
}
