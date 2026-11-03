// Builders for test data. Times are minutes after a fixed UTC moment, so a
// test reads as a story: "failed at minute 40, passed again at minute 62".

import type { Report } from '../api/plugins/types'
import type { ConditionResult, Result, StatusEvent } from '../api/types'

/** 2 Nov 2026, 13:00 UTC. */
export const base = Date.UTC(2026, 10, 2, 13, 0)

/** base plus some minutes. */
export function at(minutes: number): number {
  return base + minutes * 60_000
}

export interface ResultSpec {
  minute: number
  ok?: boolean
  ms?: number
  conditions?: ConditionResult[]
  errors?: string[]
}

export function result(spec: ResultSpec): Result {
  const ok = spec.ok ?? true
  const built: Result = {
    duration: (spec.ms ?? 70) * 1e6,
    success: ok,
    timestamp: new Date(at(spec.minute)).toISOString(),
    conditionResults: spec.conditions ?? [
      { condition: ok ? '[STATUS] < 500' : '[STATUS] (503) < 500', success: ok },
    ],
  }
  if (spec.errors !== undefined) {
    built.errors = spec.errors
  }
  return built
}

/** Results every `every` minutes ending at `last`, passing except the minutes in `failing`. */
export function results(
  count: number,
  options: { last: number; every?: number; ms?: number; failing?: number[] },
): Result[] {
  const every = options.every ?? 5
  return Array.from({ length: count }, (_, index) => {
    const minute = options.last - (count - 1 - index) * every
    const spec: ResultSpec = { minute, ok: !(options.failing ?? []).includes(minute) }
    if (options.ms !== undefined) {
      spec.ms = options.ms
    }
    return result(spec)
  })
}

export function event(type: StatusEvent['type'], minute: number): StatusEvent {
  return { type, timestamp: new Date(at(minute)).toISOString() }
}

export function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1',
    title: 'Images were slow to load',
    stage: 'investigating',
    endpoints: [{ key: 'media', name: 'Media', impact: 'degraded' }],
    updates: [{ stage: 'investigating', at: at(44), message: 'We are looking into it.' }],
    publishedAt: at(44),
    updatedAt: at(44),
    ...overrides,
  }
}
