// Shapes of the JSON that Pralvo's plugins add to the API, after the clients
// have checked them. Times are Unix milliseconds rather than the server's ISO
// strings, so the domain code never parses a date twice.

export type ReportStage = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type Impact = 'major' | 'partial' | 'degraded' | 'maintenance'

export const reportStages: readonly ReportStage[] = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]
export const impacts: readonly Impact[] = ['major', 'partial', 'degraded', 'maintenance']

/** A service a report names, with how badly it says the service is affected. */
export interface ReportEndpoint {
  key: string
  name: string
  impact: Impact
}

export interface ReportUpdate {
  stage: ReportStage
  at: number
  message: string
}

/** A published report. Drafts never reach the public API. */
export interface Report {
  id: string
  title: string
  stage: ReportStage
  endpoints: ReportEndpoint[]
  /** Newest first. A list item carries only its latest update. */
  updates: ReportUpdate[]
  publishedAt: number
  resolvedAt?: number
  updatedAt: number
}

export interface ReportPage {
  reports: Report[]
  page: number
  more: boolean
}

export type WindowState = 'upcoming' | 'in-progress' | 'finished'

export interface WindowEndpoint {
  key: string
  name: string
}

export interface MaintenanceWindow {
  title: string
  start: number
  end: number
  /** The server's view at the time it answered; the domain code uses start and end. */
  state: WindowState
  details?: string
  /** Empty means the window covers every endpoint. */
  endpoints: WindowEndpoint[]
}
