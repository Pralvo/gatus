// Report calls of the admin API, and the checks on what they return.

import { isRecord, readList, readName, readOneOf, readText, readTime } from '../../api/plugins/read'
import { impacts, reportStages, type ReportStage } from '../../api/plugins/types'

import { AdminError, type Send } from './client'
import type { Affected, AdminReport, AdminUpdate, NewReport, ReportChange } from './types'

function readAffected(value: unknown): Affected | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const key = readName(value.key)
  const impact = readOneOf(value.impact, impacts)
  return key === undefined || impact === undefined ? undefined : { key, impact }
}

function readUpdate(value: unknown): AdminUpdate | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const stage = readOneOf(value.stage, reportStages)
  const at = readTime(value.at)
  const message = readText(value.message)
  if (stage === undefined || at === undefined || message === undefined) {
    return undefined
  }
  const seq = typeof value.seq === 'number' ? value.seq : 0
  return { seq, at, actor: readText(value.actor) ?? '', stage, message }
}

/** Checks one report. A report missing its id, title, stage or creation time is dropped. */
export function readAdminReport(value: unknown): AdminReport | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const id = readName(value.id)
  const title = readText(value.title)
  const stage = readOneOf(value.stage, reportStages)
  const createdAt = readTime(value.created_at)
  if (id === undefined || title === undefined || stage === undefined || createdAt === undefined) {
    return undefined
  }
  return {
    id,
    title,
    stage,
    endpoints: readList(value.endpoints, readAffected),
    updates: readList(value.updates, readUpdate).sort((a, b) => a.seq - b.seq || a.at - b.at),
    publishedAt: readTime(value.published_at) ?? null,
    resolvedAt: readTime(value.resolved_at) ?? null,
    createdBy: readText(value.created_by) ?? '',
    createdAt,
    updatedAt: readTime(value.updated_at) ?? createdAt,
  }
}

function oneReport(value: unknown): AdminReport {
  const report = readAdminReport(value)
  if (report === undefined) {
    throw new AdminError('refused', 'The server sent a report this page cannot read.')
  }
  return report
}

export interface ReportQuery {
  limit?: number
  published?: boolean
}

function path(id: string): string {
  return `/reports/${encodeURIComponent(id)}`
}

export function reportCalls(send: Send) {
  return {
    /** Reports with their latest update, most recently changed first. */
    async listReports(query: ReportQuery = {}): Promise<AdminReport[]> {
      const params = new URLSearchParams({ limit: String(query.limit ?? 200) })
      if (query.published === true) {
        params.set('published', 'true')
      }
      const body = await send('GET', `/reports?${params.toString()}`)
      if (!isRecord(body) || !Array.isArray(body.reports)) {
        throw new AdminError('refused', 'The server sent a list this page cannot read.')
      }
      return readList(body.reports, readAdminReport)
    },
    async getReport(id: string): Promise<AdminReport> {
      return oneReport(await send('GET', path(id)))
    },
    async createReport(input: NewReport): Promise<AdminReport> {
      return oneReport(await send('POST', '/reports', input))
    },
    async changeReport(id: string, change: ReportChange): Promise<AdminReport> {
      return oneReport(await send('PATCH', path(id), change))
    },
    async addReportUpdate(id: string, stage: ReportStage, message: string): Promise<AdminReport> {
      return oneReport(await send('POST', `${path(id)}/updates`, { stage, message }))
    },
    async setReportPublished(id: string, published: boolean): Promise<AdminReport> {
      return oneReport(await send('PUT', `${path(id)}/publication`, { published }))
    },
  }
}

export type ReportCalls = ReturnType<typeof reportCalls>
