// The 91-day record calendar (spec 4.7): each day's worst state from events,
// reports and maintenance, with the details a chosen day shows.

import type { MaintenanceWindow, Report } from '../../api/plugins/types'
import type { StatusEvent } from '../../api/types'
import { covers, windowsDuring } from '../notices/maintenance'
import {
  dayMs,
  floorToMinute,
  minuteMs,
  minutesText,
  startOfUtcDay,
  utcClockNear,
  utcDay,
} from '../time/format'

import { failureIntervals, overlapMs, recordStart } from './intervals'

export type DayKind = 'ok' | 'minor' | 'major' | 'maintenance' | 'no-record'

export interface ReportRef {
  id: string
  title: string
}

export type DayItem =
  | {
      kind: 'failed'
      key: string
      name: string
      /** This day's part of the failure. */
      from: number
      /** Null while the failure is still open at the record's end. */
      to: number | null
      minutes: number
      /** Open reports naming this service that day. */
      reports: ReportRef[]
      /** A moment inside the failure, for "See the page at 13:50 UTC". */
      seeAt: number
    }
  | {
      kind: 'report'
      id: string
      title: string
      names: string[]
      publishedAt: number
      publishedThatDay: boolean
    }
  | { kind: 'maintenance'; title: string; names: string[]; start: number; end: number }

export interface RecordDay {
  /** Midnight UTC. */
  start: number
  kind: DayKind
  failedMinutes: number
  items: DayItem[]
}

export interface RecordService {
  key: string
  name: string
  /** Left out while the service's events are loading. */
  events?: StatusEvent[]
}

export interface RecordInput {
  services: RecordService[]
  reports: Report[]
  windows: MaintenanceWindow[]
  /** Now, or the time-travel moment; the record ends on its day. */
  end: number
  /** One service's key, or null for all services. */
  filter?: string | null
}

export interface TrackRecord {
  days: RecordDay[]
  first: number
  last: number
  /** When monitoring began; null when no events are loaded. */
  recordStart: number | null
  /** False while some service's events are still loading. */
  complete: boolean
}

export const recordDays = 91
const majorAfterMs = 30 * minuteMs

function reportEnd(report: Report, end: number): number {
  return Math.min(report.resolvedAt ?? end, end)
}

function namesOf(entries: { key: string; name: string }[], services: RecordService[]): string[] {
  return entries.map(
    (entry) => services.find((service) => service.key === entry.key)?.name ?? entry.name,
  )
}

function failedItems(
  services: RecordService[],
  dayStart: number,
  end: number,
  reports: Report[],
): DayItem[] {
  const dayEnd = Math.min(dayStart + dayMs, end)
  return services.flatMap((service) =>
    failureIntervals(service.events, end).flatMap((interval): DayItem[] => {
      const ms = overlapMs(interval, dayStart, dayEnd)
      const touches = interval.start < dayEnd && interval.end >= dayStart
      if (!touches || (ms === 0 && !interval.open)) {
        return []
      }
      const from = Math.max(interval.start, dayStart)
      const to = interval.open && interval.end <= dayEnd ? null : Math.min(interval.end, dayEnd)
      const attached = reports.filter((report) =>
        report.endpoints.some((endpoint) => endpoint.key === service.key),
      )
      return [
        {
          kind: 'failed',
          key: service.key,
          name: service.name,
          from,
          to,
          minutes: Math.round(ms / minuteMs),
          reports: attached.map((report) => ({ id: report.id, title: report.title })),
          seeAt: floorToMinute(from + ((to ?? end) - from) / 2),
        },
      ]
    }),
  )
}

function dayKind(failedMs: number, items: DayItem[]): DayKind {
  if (failedMs >= majorAfterMs) {
    return 'major'
  }
  const reported =
    items.some((item) => item.kind === 'report') ||
    items.some((item) => item.kind === 'failed' && item.reports.length > 0)
  if (failedMs > 0 || reported || items.some((item) => item.kind === 'failed')) {
    return 'minor'
  }
  return items.some((item) => item.kind === 'maintenance') ? 'maintenance' : 'ok'
}

function onlyMaintenance(report: Report): boolean {
  return (
    report.endpoints.length > 0 &&
    report.endpoints.every((endpoint) => endpoint.impact === 'maintenance')
  )
}

function buildDay(input: RecordInput, services: RecordService[], dayStart: number): RecordDay {
  const { end } = input
  const dayEnd = Math.min(dayStart + dayMs, end)
  const filter = input.filter ?? null
  const reports = input.reports.filter(
    (report) =>
      report.publishedAt < dayEnd &&
      reportEnd(report, end) >= dayStart &&
      (filter === null || report.endpoints.some((endpoint) => endpoint.key === filter)),
  )
  const failed = failedItems(
    services,
    dayStart,
    end,
    reports.filter((report) => !onlyMaintenance(report)),
  )
  const attachedIds = new Set(
    failed.flatMap((item) => (item.kind === 'failed' ? item.reports.map((ref) => ref.id) : [])),
  )
  const reportItems: DayItem[] = reports
    .filter((report) => !attachedIds.has(report.id))
    .map((report) =>
      onlyMaintenance(report)
        ? {
            kind: 'maintenance',
            title: report.title,
            names: namesOf(report.endpoints, services),
            start: report.publishedAt,
            end: reportEnd(report, end),
          }
        : {
            kind: 'report',
            id: report.id,
            title: report.title,
            names: namesOf(report.endpoints, services),
            publishedAt: report.publishedAt,
            publishedThatDay: report.publishedAt >= dayStart,
          },
    )
  const windows = windowsDuring(input.windows, dayStart, dayEnd).filter(
    (window) => filter === null || covers(window, filter),
  )
  const windowItems: DayItem[] = windows.map((window) => ({
    kind: 'maintenance',
    title: window.title,
    names: namesOf(window.endpoints, services),
    start: window.start,
    end: window.end,
  }))
  const items = [...failed, ...reportItems, ...windowItems]
  const failedMs = services.reduce(
    (sum, service) =>
      sum +
      failureIntervals(service.events, end).reduce(
        (inner, interval) => inner + overlapMs(interval, dayStart, dayEnd),
        0,
      ),
    0,
  )
  return {
    start: dayStart,
    kind: dayKind(failedMs, items),
    failedMinutes: Math.round(failedMs / minuteMs),
    items,
  }
}

/**
 * Builds the calendar: 91 days ending on the day of `end`, oldest first. Days
 * before the day monitoring began are "no record". A filter keeps one service,
 * the reports naming it and the windows covering it.
 */
export function buildRecord(input: RecordInput): TrackRecord {
  const filter = input.filter ?? null
  const services =
    filter === null ? input.services : input.services.filter((service) => service.key === filter)
  const start = recordStart(input.services.map((service) => service.events))
  const firstRecordedDay = start === null ? Number.POSITIVE_INFINITY : startOfUtcDay(start)
  const last = startOfUtcDay(input.end)
  const first = last - (recordDays - 1) * dayMs
  const days = Array.from({ length: recordDays }, (_, index): RecordDay => {
    const dayStart = first + index * dayMs
    return dayStart < firstRecordedDay
      ? { start: dayStart, kind: 'no-record', failedMinutes: 0, items: [] }
      : buildDay(input, services, dayStart)
  })
  return {
    days,
    first,
    last,
    recordStart: start,
    complete: services.every((service) => service.events !== undefined),
  }
}

function covered(names: string[]): string {
  return names.length === 0 ? 'All services' : names.join(', ')
}

function itemText(item: DayItem, dayStart: number): string {
  const near = (ms: number) => utcClockNear(ms, dayStart)
  switch (item.kind) {
    case 'failed': {
      const span =
        item.to === null
          ? `from ${near(item.from)}, still failing`
          : `${near(item.from).replace(' UTC', '')} to ${near(item.to)}`
      const quoted = item.reports.map((ref) => ` Report: “${ref.title}”.`).join('')
      return `${item.name} failed checks for ${minutesText(item.minutes)} (${span}).${quoted}`
    }
    case 'report': {
      const lead = item.names.length === 0 ? 'Report' : `${item.names.join(', ')}: report`
      return item.publishedThatDay
        ? `${lead} “${item.title}” published at ${near(item.publishedAt)}.`
        : `${lead} “${item.title}” was open.`
    }
    default:
      return `${covered(item.names)}: maintenance “${item.title}”, ${near(item.start).replace(' UTC', '')} to ${near(item.end)}.`
  }
}

/** The detail line for a chosen day: "2 Nov: Media failed checks for 22 minutes (13:40 to 14:02 UTC)." */
export function dayDetail(day: RecordDay): string {
  const label = utcDay(day.start)
  if (day.kind === 'no-record') {
    return `${label}: no record.`
  }
  if (day.items.length === 0) {
    return `${label}: no failed checks.`
  }
  return `${label}: ${day.items.map((item) => itemText(item, day.start)).join(' ')}`
}

/** "13 Aug to 2 Nov. Each column is 7 days; the newest day is at the bottom right." */
export function recordCaption(record: TrackRecord): string {
  return `${utcDay(record.first)} to ${utcDay(record.last)}. Each column is 7 days; the newest day is at the bottom right.`
}

/** The legend entry for no-record days: "No record (before 12 Oct, when monitoring began)". */
export function noRecordCaption(start: number | null): string {
  return start === null ? 'No record' : `No record (before ${utcDay(start)}, when monitoring began)`
}

export const accuracyCaption =
  'Failed-check minutes are measured from checks every 5 to 30 minutes, so they are accurate to about one check, and short problems can be missed.'
