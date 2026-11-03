// Shapes of the incidents plugin's token API under /api/v1/admin, after the
// client has checked them. Times are Unix milliseconds. Every string is text
// someone with a token wrote, so it is only ever rendered as text.

import type { Impact, ReportStage } from '../../api/plugins/types'

export type Severity = 'critical' | 'major' | 'minor'
export type IncidentState = 'open' | 'mitigated' | 'resolved' | 'cancelled' | 'closed'
export type EntryKind =
  'created' | 'note' | 'state' | 'title' | 'severity' | 'commander' | 'postmortem' | 'report-link'

export const severities: readonly Severity[] = ['critical', 'major', 'minor']
export const incidentStates: readonly IncidentState[] = [
  'open',
  'mitigated',
  'resolved',
  'cancelled',
  'closed',
]
export const entryKinds: readonly EntryKind[] = [
  'created',
  'note',
  'state',
  'title',
  'severity',
  'commander',
  'postmortem',
  'report-link',
]

/** A service a report names, by its Gatus key, with the impact the report gives it. */
export interface Affected {
  key: string
  impact: Impact
}

export interface AdminUpdate {
  seq: number
  at: number
  actor: string
  stage: ReportStage
  message: string
}

/** A report as the admin sees it, draft or published. */
export interface AdminReport {
  id: string
  title: string
  stage: ReportStage
  endpoints: Affected[]
  /** Oldest first. A list item carries only its latest update. */
  updates: AdminUpdate[]
  publishedAt: number | null
  resolvedAt: number | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

export interface TimelineEntry {
  seq: number
  at: number
  actor: string
  kind: EntryKind
  from: string
  to: string
  note: string
}

/** An internal incident. Empty strings stand for the fields the server leaves out. */
export interface AdminIncident {
  id: string
  title: string
  severity: Severity
  commander: string
  state: IncidentState
  postmortem: string
  reportId: string
  createdBy: string
  createdAt: number
  updatedAt: number
  /** Oldest first. Empty in a list. */
  timeline: TimelineEntry[]
}

export interface NewReport {
  title: string
  stage: ReportStage
  message: string
  endpoints: Affected[]
  published: boolean
}

/** Only the fields that changed. */
export interface ReportChange {
  title?: string
  endpoints?: Affected[]
}

export interface NewIncident {
  title: string
  severity: Severity
  commander: string
}

/** Only the fields that changed. An empty commander or report link clears it. */
export interface IncidentChange {
  title?: string
  severity?: Severity
  commander?: string
  postmortem?: string
  report_id?: string
}
