// The minute cycle (spec section 2 and 9.2): statuses, reports, maintenance and
// config on load and every minute, paused in hidden tabs, backing off to five
// minutes after three failures in a row. React Query keeps the last good data
// when a refresh fails, so nothing blanks. Time travel turns refreshing off.

import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { getEndpointStatuses, getServerConfig } from '../api/gatus'
import { HttpError } from '../api/http'
import { getMaintenance } from '../api/plugins/maintenance'
import { getReports } from '../api/plugins/reports'
import type { MaintenanceWindow, ReportPage } from '../api/plugins/types'
import type { EndpointStatus, HistoryWindow, ServerConfig } from '../api/types'
import { usePageConfig } from '../config/context'
import { refreshDelayMs, refreshEveryMs, type RefreshState } from '../domain/freshness/refresh'

import { counted, failuresInRow } from './streak'

export const queryKeys = {
  statuses: (pageSize: number) => ['statuses', pageSize] as const,
  reports: (page: number) => ['reports', page] as const,
  reportPages: (start: number) => ['reports', 'pages', start] as const,
  report: (id: string) => ['report', id] as const,
  maintenance: ['maintenance'] as const,
  config: ['config'] as const,
  events: (key: string) => ['events', key] as const,
  history: (key: string, window: HistoryWindow = '7d') => ['history', key, window] as const,
  uptime: (key: string) => ['uptime', key, '30d'] as const,
  checks: (key: string, page: number) => ['checks', key, page] as const,
  flow: (key: string) => ['flow', key] as const,
}

export interface Live {
  /** False in time travel: load once and never refresh. */
  live: boolean
}

/** Options shared by the minute-cycle queries. */
export function minuteOptions<T>(
  client: QueryClient,
  queryKey: QueryKey,
  fetcher: () => Promise<T>,
  { live }: Live,
) {
  return {
    queryKey,
    queryFn: counted(client, queryKey, fetcher),
    // Each refresh is one attempt; the next minute is the retry.
    retry: false,
    staleTime: refreshEveryMs,
    refetchInterval: live
      ? () => refreshDelayMs(failuresInRow(client, queryKey))
      : (false as const),
    // Hidden tabs do not refresh; showing the tab again refreshes stale data.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
  }
}

/** A plugin that is not enabled answers 404; that means "nothing", not a failure. */
export async function emptyWhenMissing<T>(fetch: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fetch()
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return empty
    }
    throw error
  }
}

export interface MinuteCycle {
  statuses: UseQueryResult<EndpointStatus[]>
  reports: UseQueryResult<ReportPage>
  maintenance: UseQueryResult<MaintenanceWindow[]>
  config: UseQueryResult<ServerConfig>
  /** Freshness of the cycle, led by the statuses: the page's core. */
  refresh: RefreshState
  /** Reports or maintenance failed while the statuses did not: spec section 8's warning. */
  noticesFailed: boolean
  /** "Refresh now": refetches all four. */
  refreshNow: () => Promise<void>
}

/** The four minute-cycle queries of the home page, with refresh state. */
export function useMinuteCycle(options: Live = { live: true }): MinuteCycle {
  const client = useQueryClient()
  const pageSize = usePageConfig().maximumNumberOfResults
  const statusesKey = queryKeys.statuses(pageSize)
  const statuses = useQuery(
    minuteOptions(client, statusesKey, () => getEndpointStatuses(pageSize), options),
  )
  const reports = useQuery(
    minuteOptions(
      client,
      queryKeys.reports(1),
      () => emptyWhenMissing(() => getReports(1), { reports: [], page: 1, more: false }),
      options,
    ),
  )
  const maintenance = useQuery(
    minuteOptions(
      client,
      queryKeys.maintenance,
      () => emptyWhenMissing(() => getMaintenance(), []),
      options,
    ),
  )
  const config = useQuery(minuteOptions(client, queryKeys.config, () => getServerConfig(), options))
  const { refetch: refetchStatuses } = statuses
  const { refetch: refetchReports } = reports
  const { refetch: refetchMaintenance } = maintenance
  const { refetch: refetchConfig } = config
  const refreshNow = useCallback(async () => {
    await Promise.all([refetchStatuses(), refetchReports(), refetchMaintenance(), refetchConfig()])
  }, [refetchStatuses, refetchReports, refetchMaintenance, refetchConfig])
  return {
    statuses,
    reports,
    maintenance,
    config,
    refresh: {
      lastSuccessAt: statuses.dataUpdatedAt === 0 ? null : statuses.dataUpdatedAt,
      failuresInRow: statuses.isError ? Math.max(1, failuresInRow(client, statusesKey)) : 0,
    },
    noticesFailed: !statuses.isError && (reports.isError || maintenance.isError),
    refreshNow,
  }
}

/**
 * The current time, ticking every `everyMs`, for relative times and staleness.
 * Pure code never reads the clock; screens pass this value in as `now`.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, everyMs)
    return () => {
      clearInterval(timer)
    }
  }, [everyMs])
  return now
}
