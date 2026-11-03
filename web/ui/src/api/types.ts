// Shapes of Gatus's JSON API, as the server sends them.

/** Durations are Go time.Duration values: whole nanoseconds. */
export type Nanoseconds = number

export interface ConditionResult {
  condition: string
  success: boolean
}

export interface Result {
  status?: number
  hostname?: string
  duration: Nanoseconds
  errors?: string[]
  conditionResults?: ConditionResult[]
  success: boolean
  timestamp: string
  /** Set only on results that belong to a suite. */
  name?: string
}

export type EventType = 'START' | 'HEALTHY' | 'UNHEALTHY'

export interface StatusEvent {
  type: EventType
  timestamp: string
}

export interface EndpointStatus {
  name?: string
  group?: string
  key: string
  results: Result[]
  events?: StatusEvent[]
}

export interface SuiteResult {
  name?: string
  group?: string
  success: boolean
  timestamp: string
  duration: Nanoseconds
  endpointResults: Result[]
  errors?: string[]
}

export interface SuiteStatus {
  name?: string
  group?: string
  key: string
  results: SuiteResult[]
}

export type AnnouncementType = 'outage' | 'warning' | 'information' | 'operational' | 'none'

export interface Announcement {
  timestamp: string
  type: AnnouncementType
  message: string
  archived?: boolean
}

export interface ServerConfig {
  oidc: boolean
  authenticated: boolean
  announcements: Announcement[]
}

/** Hourly average response times, in milliseconds, keyed by Unix milliseconds. */
export interface ResponseTimeHistory {
  timestamps: number[]
  values: number[]
}

export type UptimeWindow = '1h' | '24h' | '7d' | '30d'
export type HistoryWindow = '24h' | '7d' | '30d'
