// Incident calls of the admin API, and the checks on what they return.

import { isRecord, readList, readName, readOneOf, readText, readTime } from '../../api/plugins/read'

import { AdminError, type Send } from './client'
import {
  entryKinds,
  incidentStates,
  severities,
  type AdminIncident,
  type IncidentChange,
  type IncidentState,
  type NewIncident,
  type TimelineEntry,
} from './types'

function readEntry(value: unknown): TimelineEntry | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const at = readTime(value.at)
  const kind = readOneOf(value.kind, entryKinds)
  if (at === undefined || kind === undefined) {
    return undefined
  }
  return {
    seq: typeof value.seq === 'number' ? value.seq : 0,
    at,
    actor: readText(value.actor) ?? '',
    kind,
    from: readText(value.from) ?? '',
    to: readText(value.to) ?? '',
    note: readText(value.note) ?? '',
  }
}

/** Checks one incident. One missing its id, title, severity, state or creation time is dropped. */
export function readAdminIncident(value: unknown): AdminIncident | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const id = readName(value.id)
  const title = readText(value.title)
  const severity = readOneOf(value.severity, severities)
  const state = readOneOf(value.state, incidentStates)
  const createdAt = readTime(value.created_at)
  if (
    id === undefined ||
    title === undefined ||
    severity === undefined ||
    state === undefined ||
    createdAt === undefined
  ) {
    return undefined
  }
  return {
    id,
    title,
    severity,
    state,
    commander: readText(value.commander) ?? '',
    postmortem: readText(value.postmortem) ?? '',
    reportId: readText(value.report_id) ?? '',
    createdBy: readText(value.created_by) ?? '',
    createdAt,
    updatedAt: readTime(value.updated_at) ?? createdAt,
    timeline: readList(value.timeline, readEntry).sort((a, b) => a.seq - b.seq || a.at - b.at),
  }
}

function oneIncident(value: unknown): AdminIncident {
  const incident = readAdminIncident(value)
  if (incident === undefined) {
    throw new AdminError('refused', 'The server sent an incident this page cannot read.')
  }
  return incident
}

function path(id: string): string {
  return `/incidents/${encodeURIComponent(id)}`
}

export function incidentCalls(send: Send) {
  return {
    /** Incidents without their timelines. */
    async listIncidents(): Promise<AdminIncident[]> {
      const body = await send('GET', '/incidents?limit=200')
      if (!isRecord(body) || !Array.isArray(body.incidents)) {
        throw new AdminError('refused', 'The server sent a list this page cannot read.')
      }
      return readList(body.incidents, readAdminIncident)
    },
    async getIncident(id: string): Promise<AdminIncident> {
      return oneIncident(await send('GET', path(id)))
    },
    async createIncident(input: NewIncident): Promise<AdminIncident> {
      return oneIncident(await send('POST', '/incidents', input))
    },
    async changeIncident(id: string, change: IncidentChange): Promise<AdminIncident> {
      return oneIncident(await send('PATCH', path(id), change))
    },
    async setIncidentState(id: string, state: IncidentState): Promise<AdminIncident> {
      return oneIncident(await send('POST', `${path(id)}/state`, { state }))
    },
    async addIncidentNote(id: string, note: string): Promise<AdminIncident> {
      return oneIncident(await send('POST', `${path(id)}/notes`, { note }))
    },
  }
}

export type IncidentCalls = ReturnType<typeof incidentCalls>
