// Per-service and per-report data (spec section 2): each service's events and
// 7-day history on load and every 5 minutes, 30-day uptime only when asked,
// and single reports for report pages and time travel.

import {
  keepPreviousData,
  useInfiniteQuery,
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect } from 'react'

import { getEndpointStatus, getResponseTimeHistory, getSuiteStatus, getUptime } from '../api/gatus'
import { HttpError } from '../api/http'
import { getReport, getReports } from '../api/plugins/reports'
import type { Report, ReportPage } from '../api/plugins/types'
import type {
  EndpointStatus,
  HistoryWindow,
  ResponseTimeHistory,
  StatusEvent,
  SuiteStatus,
} from '../api/types'
import { needOlderPage } from '../domain/browse/pages'
import { checksPageSize } from '../domain/checks/table'
import { refreshEveryMs } from '../domain/freshness/refresh'
import { usualFromHistory } from '../domain/status/trend'
import { minuteMs } from '../domain/time/format'

import { emptyWhenMissing, queryKeys, type Live } from './cycle'

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

/**
 * One service's hourly response times for a window. The 7-day window shares
 * its cache with useUsualSpeeds. Time travel asks for 30 days and cuts it.
 */
export function useResponseTimes(
  key: string,
  window: HistoryWindow,
  options: Live & { enabled: boolean },
): UseQueryResult<ResponseTimeHistory> {
  return useQuery({
    queryKey: queryKeys.history(key, window),
    queryFn: () => getResponseTimeHistory(key, window),
    enabled: options.enabled,
    placeholderData: keepPreviousData,
    ...slowOptions(options),
  })
}

/**
 * A page of one service's checks, 50 to a page, newest page first. A 404
 * means there is no such service and is not retried. The newest page
 * refreshes with the minute cycle; older pages stay as they loaded.
 */
export function useCheckPage(
  key: string,
  page: number,
  options: Live & { enabled: boolean },
): UseQueryResult<EndpointStatus> {
  const refresh = options.live && page === 1
  return useQuery({
    queryKey: queryKeys.checks(key, page),
    queryFn: () => getEndpointStatus(key, page, checksPageSize),
    enabled: options.enabled,
    retry: false,
    staleTime: refreshEveryMs,
    refetchInterval: refresh ? refreshEveryMs : false,
    refetchIntervalInBackground: false,
  })
}

/** One flow (a Gatus suite) and its kept runs, refreshed every minute. A 404 is not retried. */
export function useFlow(key: string): UseQueryResult<SuiteStatus> {
  return useQuery({
    queryKey: queryKeys.flow(key),
    queryFn: () => getSuiteStatus(key),
    retry: false,
    staleTime: refreshEveryMs,
    refetchInterval: refreshEveryMs,
    refetchIntervalInBackground: false,
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

export interface ReportPagesInput {
  /** The first moment the view shows: pages are loaded until they reach it. */
  from: number
  /** A first page loaded elsewhere, such as the home page's: paging starts after it. */
  first?: ReportPage
  live: boolean
  enabled?: boolean
}

export interface ReportPages {
  /** Every loaded report, in the server's order, the given first page included. */
  reports: Report[]
  /** The server has reports after the last loaded page. */
  more: boolean
  /** Nothing has loaded yet. */
  pending: boolean
  /** An older page is being asked for. */
  loadingOlder: boolean
  /** The latest request failed; loaded pages are kept. */
  failed: boolean
  updatedAt: number
  retry: () => void
}

/**
 * Pages of /api/v1/reports, from the first (or after `first`), until they
 * reach `from` (domain/browse/pages). A server without the reports plugin
 * answers 404, read as nothing published.
 */
export function useReportPages(input: ReportPagesInput): ReportPages {
  const { from, first, enabled = true } = input
  const query = useInfiniteQuery(reportPagesOptions(input))
  const pages = [...(first === undefined ? [] : [first]), ...(query.data?.pages ?? [])]
  const wanted = enabled && query.isSuccess && needOlderPage(pages, from)
  const { fetchNextPage, isFetching, isError } = query
  useEffect(() => {
    if (wanted && !isFetching && !isError) {
      void fetchNextPage()
    }
  }, [wanted, isFetching, isError, fetchNextPage])
  return {
    reports: pages.flatMap((page) => page.reports),
    more: pages.at(-1)?.more === true,
    pending: first === undefined && enabled && query.isPending,
    loadingOlder: query.isFetchingNextPage || (wanted && !isError),
    failed: isError,
    updatedAt: query.dataUpdatedAt,
    retry: () => void query.refetch(),
  }
}

function reportPagesOptions({ from, first, live, enabled = true }: ReportPagesInput) {
  const start = first === undefined ? 1 : first.page + 1
  return {
    queryKey: queryKeys.reportPages(start),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      emptyWhenMissing(() => getReports(pageParam), { reports: [], page: pageParam, more: false }),
    initialPageParam: start,
    getNextPageParam: (last: ReportPage, _all: ReportPage[], lastParam: number) =>
      last.more ? lastParam + 1 : undefined,
    enabled: enabled && (first === undefined || needOlderPage([first], from)),
    retry: false,
    staleTime: refreshEveryMs,
    refetchInterval: live && first === undefined ? refreshEveryMs : (false as const),
    refetchIntervalInBackground: false,
  }
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
