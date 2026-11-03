// Per-service and per-report data (spec section 2): each service's events and
// 7-day history on load and every 5 minutes, 30-day uptime only when asked,
// and single reports for report pages and time travel.

import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'

import { getEndpointStatus, getResponseTimeHistory, getUptime } from '../api/gatus'
import { HttpError } from '../api/http'
import { getReport, getReports } from '../api/plugins/reports'
import type { Report, ReportPage } from '../api/plugins/types'
import type { StatusEvent } from '../api/types'
import { refreshEveryMs } from '../domain/freshness/refresh'
import { usualFromHistory } from '../domain/status/trend'
import { minuteMs } from '../domain/time/format'

import { queryKeys, type Live } from './cycle'

export const perServiceEveryMs = 5 * minuteMs

function slowOptions({ live }: Live) {
  return {
    staleTime: perServiceEveryMs,
    refetchInterval: live ? perServiceEveryMs : (false as const),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
    retry: false,
  }
}

export interface PerService<T> {
  /** Loaded values by service key; a key is missing until its first success. */
  byKey: Map<string, T>
  /** Some request has not answered yet. */
  loading: boolean
  /** Some request's latest attempt failed (earlier data is kept). */
  failed: boolean
}

function collect<T, D>(
  keys: string[],
  results: UseQueryResult<D>[],
  pick: (data: D) => T,
): PerService<T> {
  const byKey = new Map<string, T>()
  results.forEach((result, index) => {
    const key = keys.at(index)
    if (key !== undefined && result.data !== undefined) {
      byKey.set(key, pick(result.data))
    }
  })
  return {
    byKey,
    loading: results.some((result) => result.isPending),
    failed: results.some((result) => result.isError),
  }
}

/** Each service's events, from its own status call (the list call carries none). */
export function useServiceEvents(
  keys: string[],
  options: Live = { live: true },
): PerService<StatusEvent[]> {
  return useQueries({
    queries: keys.map((key) => ({
      queryKey: queryKeys.events(key),
      queryFn: () => getEndpointStatus(key, 1, 1),
      ...slowOptions(options),
    })),
    combine: (results) => collect(keys, results, (status) => status.events ?? []),
  })
}

/** Each service's usual response time: the median of its 7-day hourly history, or null. */
export function useUsualSpeeds(
  keys: string[],
  options: Live = { live: true },
): PerService<number | null> {
  return useQueries({
    queries: keys.map((key) => ({
      queryKey: queryKeys.history(key),
      queryFn: () => getResponseTimeHistory(key, '7d'),
      ...slowOptions(options),
    })),
    combine: (results) => collect(keys, results, usualFromHistory),
  })
}

/** A service's 30-day share of passing checks, 0 to 1, loaded only once enabled. */
export function useUptime(key: string, enabled: boolean): UseQueryResult<number> {
  return useQuery({
    queryKey: queryKeys.uptime(key),
    queryFn: () => getUptime(key, '30d'),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

/** Tells a missing or draft report (404) from a failed request. */
export function isNotFound(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404
}

/** One report with every update. A draft or unknown id fails with a 404 HttpError, never retried. */
export function useReport(id: string, options: Live = { live: true }): UseQueryResult<Report> {
  return useQuery({
    queryKey: queryKeys.report(id),
    queryFn: () => getReport(id),
    retry: (failures: number, error: Error) => !isNotFound(error) && failures < 1,
    staleTime: refreshEveryMs,
    refetchInterval: options.live ? refreshEveryMs : false,
    refetchIntervalInBackground: false,
  })
}

/** A page of the reports list, for /reports?page=n. */
export function useReportsPage(
  page: number,
  options: Live = { live: true },
): UseQueryResult<ReportPage> {
  return useQuery({
    queryKey: queryKeys.reports(page),
    queryFn: () => getReports(page),
    retry: false,
    staleTime: refreshEveryMs,
    refetchInterval: options.live ? refreshEveryMs : false,
    refetchIntervalInBackground: false,
  })
}

/**
 * Full reports by id, for time travel: list items carry only their latest
 * update, so the stage at a past moment needs every update. Each report falls
 * back to the list item it came from until its details load.
 */
export function useFullReports(listed: Report[]): PerService<Report> {
  const ids = listed.map((report) => report.id)
  const loaded = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.report(id),
      queryFn: () => getReport(id),
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
    })),
    combine: (results) => collect(ids, results, (report: Report) => report),
  })
  const byKey = new Map(listed.map((report) => [report.id, loaded.byKey.get(report.id) ?? report]))
  return { ...loaded, byKey }
}
