// Typed calls to the report-pages plugin's JSON routes:
// GET /api/v1/reports?page=n and GET /api/v1/reports/{id}.

import { getJSON, ResponseFormatError, type RequestOptions } from '../http'

import { isRecord, readList, readName, readOneOf, readText, readTime } from './read'
import {
  impacts,
  reportStages,
  type Report,
  type ReportEndpoint,
  type ReportPage,
  type ReportUpdate,
} from './types'

const base = '/api/v1/reports'

function readEndpoint(value: unknown): ReportEndpoint | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const key = readName(value.key)
  const impact = readOneOf(value.impact, impacts)
  if (key === undefined || impact === undefined) {
    return undefined
  }
  return { key, name: readName(value.name) ?? key, impact }
}

function readUpdate(value: unknown): ReportUpdate | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const stage = readOneOf(value.stage, reportStages)
  const at = readTime(value.at)
  const message = readText(value.message)
  if (stage === undefined || at === undefined || message === undefined) {
    return undefined
  }
  return { stage, at, message }
}

/** Checks one report. A report missing its id, title, stage or times is dropped. */
export function readReport(value: unknown): Report | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const id = readName(value.id)
  const title = readText(value.title)
  const stage = readOneOf(value.stage, reportStages)
  const publishedAt = readTime(value.publishedAt)
  if (id === undefined || title === undefined || stage === undefined || publishedAt === undefined) {
    return undefined
  }
  const updates = readList(value.updates, readUpdate).sort((a, b) => b.at - a.at)
  const report: Report = {
    id,
    title,
    stage,
    endpoints: readList(value.endpoints, readEndpoint),
    updates,
    publishedAt,
    updatedAt: readTime(value.updatedAt) ?? updates[0]?.at ?? publishedAt,
  }
  const resolvedAt = readTime(value.resolvedAt)
  if (resolvedAt !== undefined) {
    report.resolvedAt = resolvedAt
  }
  return report
}

function pageNumber(page: number): string {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`page must be a whole number from 1, got ${String(page)}`)
  }
  return String(page)
}

/** One page of published reports: unresolved first, then most recently changed. */
export async function getReports(page = 1, options?: RequestOptions): Promise<ReportPage> {
  const url = `${base}?page=${pageNumber(page)}`
  const body = await getJSON<unknown>(url, options)
  if (!isRecord(body) || !Array.isArray(body.reports)) {
    throw new ResponseFormatError(url, 'no reports list')
  }
  return {
    reports: readList(body.reports, readReport),
    page: typeof body.page === 'number' ? body.page : page,
    more: body.more === true,
  }
}

/** One published report with every update. A draft or unknown id is an HttpError 404. */
export async function getReport(id: string, options?: RequestOptions): Promise<Report> {
  if (id === '') {
    throw new RangeError('id must not be empty')
  }
  const url = `${base}/${encodeURIComponent(id)}`
  const report = readReport(await getJSON<unknown>(url, options))
  if (report === undefined) {
    throw new ResponseFormatError(url, 'not a report')
  }
  return report
}
