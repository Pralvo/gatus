// Typed calls to Gatus's own API.

import { getJSON, getNumber, type RequestOptions } from './http'
import type {
  EndpointStatus,
  HistoryWindow,
  ResponseTimeHistory,
  ServerConfig,
  SuiteStatus,
  UptimeWindow,
} from './types'

const base = '/api/v1'

function page(pageNumber: number, pageSize: number): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new RangeError(`page must be a whole number from 1, got ${String(pageNumber)}`)
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`pageSize must be a whole number from 1, got ${String(pageSize)}`)
  }
  return `page=${String(pageNumber)}&pageSize=${String(pageSize)}`
}

function key(endpointKey: string): string {
  if (endpointKey === '') {
    throw new RangeError('key must not be empty')
  }
  return encodeURIComponent(endpointKey)
}

export function getServerConfig(options?: RequestOptions): Promise<ServerConfig> {
  return getJSON<ServerConfig>(`${base}/config`, options)
}

export function getEndpointStatuses(
  pageSize: number,
  options?: RequestOptions,
): Promise<EndpointStatus[]> {
  return getJSON<EndpointStatus[]>(`${base}/endpoints/statuses?${page(1, pageSize)}`, options)
}

export function getEndpointStatus(
  endpointKey: string,
  pageNumber: number,
  pageSize: number,
  options?: RequestOptions,
): Promise<EndpointStatus> {
  return getJSON<EndpointStatus>(
    `${base}/endpoints/${key(endpointKey)}/statuses?${page(pageNumber, pageSize)}`,
    options,
  )
}

export function getSuiteStatuses(
  pageSize: number,
  options?: RequestOptions,
): Promise<SuiteStatus[]> {
  return getJSON<SuiteStatus[]>(`${base}/suites/statuses?${page(1, pageSize)}`, options)
}

export function getSuiteStatus(suiteKey: string, options?: RequestOptions): Promise<SuiteStatus> {
  return getJSON<SuiteStatus>(`${base}/suites/${key(suiteKey)}/statuses`, options)
}

/** Share of successful checks in the window, from 0 to 1. */
export function getUptime(
  endpointKey: string,
  window: UptimeWindow,
  options?: RequestOptions,
): Promise<number> {
  return getNumber(`${base}/endpoints/${key(endpointKey)}/uptimes/${window}`, options)
}

export function getResponseTimeHistory(
  endpointKey: string,
  window: HistoryWindow,
  options?: RequestOptions,
): Promise<ResponseTimeHistory> {
  return getJSON<ResponseTimeHistory>(
    `${base}/endpoints/${key(endpointKey)}/response-times/${window}/history`,
    options,
  )
}
