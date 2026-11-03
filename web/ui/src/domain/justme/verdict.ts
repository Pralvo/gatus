// "Is it just me?" (spec 8 and 9.4): what the visitor's browser reached,
// what our monitor says about the same pages, and the verdict in words. A
// browser check is matched to the monitored service of the same name.

import type { ServiceStatus } from '../status/service'
import { durationText } from '../time/format'

export type ProbeOutcome = { reached: true; ms: number } | { reached: false; timedOut: boolean }

export type MonitorView =
  { kind: 'passing' | 'failing'; key: string; name: string } | { kind: 'not-monitored' }

export interface JustMeRow {
  page: string
  you: ProbeOutcome
  monitor: MonitorView
}

export type VerdictKind = 'all-reached' | 'you-fail' | 'monitor-fails' | 'both-fail'

export interface Verdict {
  kind: VerdictKind
  tone: 'success' | 'warning' | 'critical'
  text: string
}

export const browserCheckNote =
  'Your browser contacted these pages directly. It can tell whether they answered, not whether they worked. The result is not sent to Pralvo.'

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The monitored service whose name matches a browser check's name, if any. */
export function serviceFor(
  checkName: string,
  services: ServiceStatus[],
): ServiceStatus | undefined {
  return services.find((service) => sameName(service.name, checkName))
}

/** What our monitor says about a browser check's page. */
export function monitorFor(checkName: string, services: ServiceStatus[]): MonitorView {
  const service = serviceFor(checkName, services)
  if (service === undefined) {
    return { kind: 'not-monitored' }
  }
  return {
    kind: service.failing ? 'failing' : 'passing',
    key: service.key,
    name: service.name,
  }
}

/** Keys of services that have a browser check, for "Try it from your browser." */
export function probedKeys(checkNames: string[], services: ServiceStatus[]): Set<string> {
  return new Set(
    checkNames.flatMap((name) => {
      const service = serviceFor(name, services)
      return service === undefined ? [] : [service.key]
    }),
  )
}

const numberWords = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

function pages(count: number): string {
  if (count === 1) {
    return 'the page'
  }
  return `all ${numberWords.at(count) ?? String(count)} pages`
}

/**
 * The verdict, judged page by page: a page that fails for both means "not
 * just you"; one that fails only for the browser points at the visitor's
 * side; one that fails only for the monitor may be regional.
 */
export function verdict(rows: JustMeRow[]): Verdict {
  const failsForYou = (row: JustMeRow) => !row.you.reached
  const failsForUs = (row: JustMeRow) => row.monitor.kind === 'failing'
  if (rows.some((row) => failsForYou(row) && failsForUs(row))) {
    return {
      kind: 'both-fail',
      tone: 'critical',
      text: "It's not just you. Our monitor cannot reach these pages either.",
    }
  }
  if (rows.some(failsForYou)) {
    return {
      kind: 'you-fail',
      tone: 'warning',
      text: 'Our monitor reaches these pages, but your browser could not. The problem is likely between you and Pralvo: your network, a firewall or a VPN.',
    }
  }
  if (rows.some(failsForUs)) {
    return {
      kind: 'monitor-fails',
      tone: 'warning',
      text: 'Your browser reached these pages, but our monitor could not. It may affect some places and not others.',
    }
  }
  return {
    kind: 'all-reached',
    tone: 'success',
    text: `Your browser reached ${pages(rows.length)}. If something still fails for you, the problem is likely on your side: a browser extension, network filter or VPN.`,
  }
}

/** "Reached in 182 ms", "Not reached in 10 s" or "Not reached". */
export function youText(outcome: ProbeOutcome, timeoutMs: number): string {
  if (outcome.reached) {
    return `Reached in ${durationText(outcome.ms)}`
  }
  return outcome.timedOut ? `Not reached in ${durationText(timeoutMs)}` : 'Not reached'
}

/** "Media: passing", "Media: failing" or "Not monitored". */
export function monitorText(view: MonitorView): string {
  return view.kind === 'not-monitored' ? 'Not monitored' : `${view.name}: ${view.kind}`
}
