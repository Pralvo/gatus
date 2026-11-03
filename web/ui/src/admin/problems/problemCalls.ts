// Problem-report calls of the admin API, and the checks on what they return.

import { isRecord, readList, readName, readText, readTime } from '../../api/plugins/read'
import { AdminError, type Send } from '../api/client'

export interface ProblemReport {
  reference: string
  receivedAt: number
  service: string
  page: string
  description: string
  details: string
  country: string
  browser: string
  browserMajor: number
  os: string
}

export interface ProblemFilter {
  service?: string
  country?: string
  offset?: number
}

export interface ProblemPage {
  reports: ProblemReport[]
  more: boolean
}

export interface Tally {
  key: string
  count: number
}

export interface ProblemSummary {
  total: number
  countries: Tally[]
  services: Tally[]
}

export const pageSize = 50

/** Checks one report. One without a reference or a time is dropped. */
export function readProblem(value: unknown): ProblemReport | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const reference = readName(value.reference)
  const receivedAt = readTime(value.receivedAt)
  if (reference === undefined || receivedAt === undefined) {
    return undefined
  }
  const text = (field: unknown) => readText(field) ?? ''
  return {
    reference,
    receivedAt,
    service: text(value.service),
    page: text(value.page),
    description: text(value.description),
    details: text(value.details),
    country: text(value.country),
    browser: text(value.browser),
    browserMajor: typeof value.browserMajor === 'number' ? value.browserMajor : 0,
    os: text(value.os),
  }
}

function readTally(value: unknown): Tally | undefined {
  if (!isRecord(value) || typeof value.count !== 'number') {
    return undefined
  }
  return { key: readText(value.key) ?? '', count: value.count }
}

function query(filter: ProblemFilter): string {
  const params = new URLSearchParams({ limit: String(pageSize) })
  if (filter.service) {
    params.set('service', filter.service)
  }
  if (filter.country) {
    params.set('country', filter.country)
  }
  if (filter.offset) {
    params.set('offset', String(filter.offset))
  }
  return params.toString()
}

const malformed = () => new AdminError('unreachable', 'The server sent something unexpected.')

export function problemCalls(send: Send) {
  return {
    async listProblems(filter: ProblemFilter = {}): Promise<ProblemPage> {
      const body = await send('GET', `/problem-reports?${query(filter)}`)
      if (!isRecord(body)) {
        throw malformed()
      }
      return { reports: readList(body.reports, readProblem), more: body.more === true }
    },
    async getProblem(reference: string): Promise<ProblemReport> {
      const report = readProblem(
        await send('GET', `/problem-reports/${encodeURIComponent(reference)}`),
      )
      if (report === undefined) {
        throw malformed()
      }
      return report
    },
    async deleteProblem(reference: string): Promise<string> {
      await send('DELETE', `/problem-reports/${encodeURIComponent(reference)}`)
      return reference
    },
    async problemSummary(): Promise<ProblemSummary> {
      const body = await send('GET', '/problem-reports/summary')
      if (!isRecord(body)) {
        throw malformed()
      }
      return {
        total: typeof body.total === 'number' ? body.total : 0,
        countries: readList(body.countries, readTally),
        services: readList(body.services, readTally),
      }
    },
  }
}
