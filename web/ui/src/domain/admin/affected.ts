// The affected services of a report being edited: setting and clearing an
// impact, and telling whether anything changed since the last save.

import type { Affected, ReportChange } from '../../admin/api/types'
import type { Impact } from '../../api/plugins/types'

/** The choices in the order the editor offers them; null is "Not affected". */
export const impactChoices: readonly { value: Impact | null; label: string }[] = [
  { value: null, label: 'Not affected' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'partial', label: 'Partial outage' },
  { value: 'major', label: 'Major outage' },
  { value: 'maintenance', label: 'Maintenance' },
]

export function impactLabel(impact: Impact | null): string {
  return impactChoices.find((choice) => choice.value === impact)?.label ?? 'Not affected'
}

export function impactOf(affected: readonly Affected[], key: string): Impact | null {
  return affected.find((entry) => entry.key === key)?.impact ?? null
}

/** Sets one service's impact, or removes it for null, keeping the others in place. */
export function withImpact(
  affected: readonly Affected[],
  key: string,
  impact: Impact | null,
): Affected[] {
  const rest = affected.filter((entry) => entry.key !== key)
  if (impact === null) {
    return rest
  }
  const index = affected.findIndex((entry) => entry.key === key)
  const next = { key, impact }
  if (index < 0) {
    return [...rest, next]
  }
  return [...rest.slice(0, index), next, ...rest.slice(index)]
}

function canonical(affected: readonly Affected[]): string {
  return affected
    .map((entry) => `${entry.key}\u0000${entry.impact}`)
    .sort()
    .join('\u0001')
}

/** Whether two lists name the same services with the same impacts, in any order. */
export function sameAffected(a: readonly Affected[], b: readonly Affected[]): boolean {
  return canonical(a) === canonical(b)
}

export interface ReportChoices {
  title: string
  endpoints: readonly Affected[]
}

/** The fields that differ from what was saved; empty when nothing changed. */
export function changeBetween(saved: ReportChoices, edited: ReportChoices): ReportChange {
  const change: ReportChange = {}
  const title = edited.title.trim()
  if (title !== saved.title) {
    change.title = title
  }
  if (!sameAffected(saved.endpoints, edited.endpoints)) {
    change.endpoints = [...edited.endpoints]
  }
  return change
}

export function isEmptyChange(change: ReportChange): boolean {
  return change.title === undefined && change.endpoints === undefined
}
