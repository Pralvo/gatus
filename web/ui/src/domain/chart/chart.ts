// The service page's response-time chart (spec 4.2 item 5), as data: the
// points, the axis maximum taken from the data, the grey band for the middle
// half of the period, the failed periods to shade, a sentence describing it
// and the rows of its table. Gatus keeps hourly averages in milliseconds, and
// an hour with no checks comes back as 0, which means "no data", not "0 ms".

import type { HistoryWindow, ResponseTimeHistory, StatusEvent } from '../../api/types'
import { failureIntervals, overlapMs } from '../record/intervals'
import { median } from '../status/trend'
import {
  dayMs,
  durationText,
  hourMs,
  minuteMs,
  startOfUtcDay,
  utcClockNear,
  utcDay,
} from '../time/format'

export type ChartRange = HistoryWindow

export const chartRanges: { range: ChartRange; label: string }[] = [
  { range: '24h', label: '24 hours' },
  { range: '7d', label: '7 days' },
  { range: '30d', label: '30 days' },
]

const days = new Map<ChartRange, number>([
  ['24h', 1],
  ['7d', 7],
  ['30d', 30],
])

/** How many days a range covers. */
export function rangeDays(range: ChartRange): number {
  return days.get(range) ?? 1
}

export function rangeLabel(range: ChartRange): string {
  return chartRanges.find((entry) => entry.range === range)?.label ?? range
}

export interface ChartPoint {
  at: number
  ms: number
}

export interface FailedPeriod {
  from: number
  to: number
}

export interface ChartRow {
  /** "13:00 UTC" for hours, "2 Nov" for days. */
  label: string
  from: number
  /** The median hourly average in the row, in words; null when nothing was recorded. */
  response: string | null
  /** Minutes of failed checks in the row, from the record. */
  failedMinutes: number
}

export interface ChartModel {
  range: ChartRange
  start: number
  end: number
  points: ChartPoint[]
  /** The top of the axis: a round number at or above the slowest point. */
  max: number
  /** The middle half of the points: the 25th to the 75th percentile. */
  band: { low: number; high: number } | null
  median: number | null
  /** Failed periods inside the range; null while the record is not loaded. */
  failed: FailedPeriod[] | null
  /** The chart in words, for its accessible name and caption. */
  description: string
  rows: ChartRow[]
}

export interface ChartInput {
  history: ResponseTimeHistory | undefined
  range: ChartRange
  /** Now, or the time-travel moment: the period ends here. */
  end: number
  /** The service's events, for failed periods; left out while loading. */
  events?: StatusEvent[]
  /** True in time travel: "the 24 hours to 13:50 UTC" instead of "the last 24 hours". */
  past?: boolean
}

/** The value below which a share of the sorted values falls, by linear interpolation. */
export function quantile(sorted: number[], share: number): number | null {
  if (sorted.length === 0) {
    return null
  }
  const position = (sorted.length - 1) * share
  const below = Math.floor(position)
  const low = sorted.at(below) ?? 0
  const high = sorted.at(Math.min(below + 1, sorted.length - 1)) ?? low
  return low + (high - low) * (position - below)
}

/** A round axis top at or above the value: 1, 2, 2.5 or 5 times a power of ten. */
export function roundMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 100
  }
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= value) ?? 10
  return step * power
}

function pointsOf(history: ResponseTimeHistory | undefined, start: number, end: number) {
  const values = history?.values ?? []
  return (history?.timestamps ?? [])
    .map((at, index): ChartPoint => ({ at, ms: values.at(index) ?? 0 }))
    .filter((point) => point.ms > 0 && point.at >= start && point.at <= end)
    .sort((a, b) => a.at - b.at)
}

function failedPeriods(events: StatusEvent[] | undefined, start: number, end: number) {
  if (events === undefined) {
    return null
  }
  return failureIntervals(events, end)
    .filter((interval) => interval.end > start)
    .map((interval) => ({ from: Math.max(interval.start, start), to: interval.end }))
}

function rowsOf(model: Omit<ChartModel, 'rows' | 'description'>): ChartRow[] {
  const hourly = model.range === '24h'
  const size = hourly ? hourMs : dayMs
  const count = hourly ? 24 : rangeDays(model.range)
  const last = hourly ? Math.floor(model.end / hourMs) * hourMs : startOfUtcDay(model.end)
  return Array.from({ length: count }, (_, index) => {
    const from = last - (count - 1 - index) * size
    const to = from + size
    const inside = model.points.filter((point) => point.at >= from && point.at < to)
    const middle = median(inside.map((point) => point.ms))
    const failedMs = (model.failed ?? []).reduce(
      (sum, period) => sum + overlapMs({ start: period.from, end: period.to }, from, to),
      0,
    )
    return {
      label: hourly ? utcClockNear(from, model.end) : utcDay(from),
      from,
      response: middle === null ? null : durationText(middle),
      failedMinutes: Math.round(failedMs / minuteMs),
    }
  })
}

function periodWords(range: ChartRange, end: number, past: boolean): string {
  return past
    ? `the ${rangeLabel(range)} to ${utcClockNear(end, end)}`
    : `the last ${rangeLabel(range)}`
}

function failedWords(failed: FailedPeriod[] | null): string {
  if (failed === null) {
    return ''
  }
  if (failed.length === 0) {
    return ' No failed checks in this period.'
  }
  const periods = failed.length === 1 ? '1 period' : `${String(failed.length)} periods`
  return ` Shaded: ${periods} of failed checks.`
}

function describeChart(model: Omit<ChartModel, 'rows' | 'description'>, past: boolean): string {
  const period = periodWords(model.range, model.end, past)
  if (model.median === null || model.band === null) {
    return `No response times were recorded in ${period}.${failedWords(model.failed)}`
  }
  const slowest = Math.max(...model.points.map((point) => point.ms))
  return (
    `Hourly averages over ${period}: median ${durationText(model.median)}; ` +
    `the middle half of hours ${durationText(model.band.low)} to ${durationText(model.band.high)}; ` +
    `the slowest hour ${durationText(slowest)}.${failedWords(model.failed)}`
  )
}

/** The chart for one range, ending at now or at the time-travel moment. */
export function chartModel(input: ChartInput): ChartModel {
  const { range, end } = input
  const start = end - rangeDays(range) * dayMs
  const points = pointsOf(input.history, start, end)
  const sorted = points.map((point) => point.ms).sort((a, b) => a - b)
  const low = quantile(sorted, 0.25)
  const high = quantile(sorted, 0.75)
  const base = {
    range,
    start,
    end,
    points,
    max: roundMax(sorted.at(-1) ?? 0),
    band: low === null || high === null ? null : { low, high },
    median: median(sorted),
    failed: failedPeriods(input.events, start, end),
  }
  return { ...base, description: describeChart(base, input.past ?? false), rows: rowsOf(base) }
}
