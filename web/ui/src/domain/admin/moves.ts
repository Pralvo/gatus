// Incident moves and timeline words. The moves mirror the incidents plugin's
// own state machine (plugins/incidents/record/rules.go), so the admin offers
// only moves the server accepts: any state but closed can go back to open, and
// closed is reached only from resolved or cancelled.

import type { IncidentChange, IncidentState, Severity, TimelineEntry } from '../../admin/api/types'

const moves = new Map<IncidentState, readonly IncidentState[]>([
  ['open', ['mitigated', 'resolved', 'cancelled']],
  ['mitigated', ['open', 'resolved', 'cancelled']],
  ['resolved', ['open', 'closed']],
  ['cancelled', ['open', 'closed']],
  ['closed', []],
])

/** The states an incident may move to from `from`, in the order they are offered. */
export function validMoves(from: IncidentState): readonly IncidentState[] {
  return moves.get(from) ?? []
}

export function canMove(from: IncidentState, to: IncidentState): boolean {
  return validMoves(from).includes(to)
}

/** A closed incident can no longer change in any way. */
export function isFrozen(state: IncidentState): boolean {
  return state === 'closed'
}

function capital(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** "Open", "Mitigated", ... */
export function stateWord(state: IncidentState): string {
  return capital(state)
}

/** "Critical", "Major", "Minor". */
export function severityWord(severity: Severity): string {
  return capital(severity)
}

function wordOrNone(value: string): string {
  return value === '' ? 'none' : `“${value}”`
}

/** What one timeline entry says, after its actor: "moved it from Open to Mitigated". */
export function entryText(entry: TimelineEntry): string {
  switch (entry.kind) {
    case 'created':
      return 'opened the incident'
    case 'note':
      return 'added a note'
    case 'state':
      return `moved it from ${capital(entry.from)} to ${capital(entry.to)}`
    case 'title':
      return `renamed it from ${wordOrNone(entry.from)} to ${wordOrNone(entry.to)}`
    case 'severity':
      return `changed the severity from ${capital(entry.from)} to ${capital(entry.to)}`
    case 'commander':
      return entry.to === ''
        ? 'cleared the commander'
        : `made ${wordOrNone(entry.to)} the commander`
    case 'postmortem':
      return 'edited the postmortem'
    default:
      return entry.to === '' ? 'removed the report link' : `linked report ${entry.to}`
  }
}

/** The fields of an incident the details form edits. */
export interface IncidentChoices {
  title: string
  severity: Severity
  commander: string
  reportId: string
  postmortem: string
}

/** The fields that differ from what was saved; empty when nothing changed. */
export function incidentChangeBetween(
  saved: IncidentChoices,
  edited: IncidentChoices,
): IncidentChange {
  const change: IncidentChange = {}
  if (edited.title.trim() !== saved.title) {
    change.title = edited.title.trim()
  }
  if (edited.severity !== saved.severity) {
    change.severity = edited.severity
  }
  if (edited.commander.trim() !== saved.commander) {
    change.commander = edited.commander.trim()
  }
  if (edited.reportId.trim() !== saved.reportId) {
    change.report_id = edited.reportId.trim()
  }
  if (edited.postmortem !== saved.postmortem) {
    change.postmortem = edited.postmortem
  }
  return change
}
