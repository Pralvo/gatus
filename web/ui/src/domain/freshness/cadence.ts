// "How often" for "About this page" (spec 4.1): each service's usual gap
// between checks, the median gap between its kept results, put in words and
// grouped where equal: "Website and Blog about every 5 minutes, Media about
// every 10." The gap is measured, not configured, so it is always "about".

import type { Result } from '../../api/types'
import { inOrder } from '../status/trend'
import { hourMs, minuteMs, secondMs } from '../time/format'

import { usualGapMs } from './staleness'

export interface CadenceService {
  name: string
  results: Result[]
}

type Unit = 'second' | 'minute' | 'hour'

export interface Gap {
  amount: number
  unit: Unit
}

/** A gap as a reader needs it: whole seconds under a minute, whole minutes under an hour, whole hours above. */
export function roundedGap(ms: number): Gap {
  if (ms < minuteMs) {
    return { amount: Math.max(1, Math.round(ms / secondMs)), unit: 'second' }
  }
  const minutes = Math.round(ms / minuteMs)
  if (minutes < 60) {
    return { amount: minutes, unit: 'minute' }
  }
  return { amount: Math.round(ms / hourMs), unit: 'hour' }
}

/** "about every minute", "about every 5 minutes", or "about every 10" after a group in the same unit. */
export function everyText(gap: Gap, withUnit = true): string {
  if (gap.amount === 1) {
    return `about every ${gap.unit}`
  }
  return withUnit
    ? `about every ${String(gap.amount)} ${gap.unit}s`
    : `about every ${String(gap.amount)}`
}

/** "Website", "Website and Blog", "Website, Blog and Media": every name, never a count. */
export function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? ''
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

const unitMs: Record<Unit, number> = { second: secondMs, minute: minuteMs, hour: hourMs }

interface CadenceGroup {
  gap: Gap
  names: string[]
}

function groupsOf(services: CadenceService[]): { groups: CadenceGroup[]; unknown: string[] } {
  const byGap = new Map<string, CadenceGroup>()
  const unknown: string[] = []
  for (const service of services) {
    const gapMs = usualGapMs(inOrder(service.results))
    if (gapMs === null) {
      unknown.push(service.name)
      continue
    }
    const gap = roundedGap(gapMs)
    const id = `${String(gap.amount)} ${gap.unit}`
    const group = byGap.get(id) ?? { gap, names: [] }
    group.names.push(service.name)
    byGap.set(id, group)
  }
  const groups = [...byGap.values()].sort(
    (a, b) => a.gap.amount * unitMs[a.gap.unit] - b.gap.amount * unitMs[b.gap.unit],
  )
  return { groups, unknown }
}

/**
 * "Website and Blog about every 5 minutes, Content system and Media about
 * every 10, Database about every 30." Services with fewer than two kept
 * checks get their own sentence. Null when there are no services.
 */
export function howOftenText(services: CadenceService[]): string | null {
  if (services.length === 0) {
    return null
  }
  const { groups, unknown } = groupsOf(services)
  const parts = groups.map((group, index) => {
    const previous = groups.at(index - 1)
    const sameUnit = index > 0 && previous?.gap.unit === group.gap.unit
    return `${listNames(group.names)} ${everyText(group.gap, !sameUnit)}`
  })
  const sentences = parts.length === 0 ? [] : [`${parts.join(', ')}.`]
  if (unknown.length > 0) {
    sentences.push(`${listNames(unknown)}: not enough checks yet to tell.`)
  }
  return sentences.join(' ')
}
