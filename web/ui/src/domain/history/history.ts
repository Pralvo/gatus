// A service's history (spec 4.2 item 8): every event Gatus keeps, in words,
// newest first. Events outlive check details, so this is how far back the
// page can say when the service started and stopped failing.

import type { StatusEvent } from '../../api/types'
import { timedEvents } from '../record/intervals'
import type { Tone } from '../status/service'
import { minuteMs, minutesText } from '../time/format'

export type HistoryKind = 'start' | 'failed' | 'passed'

export interface HistoryItem {
  at: number
  kind: HistoryKind
  tone: Tone
  text: string
}

/** How many items the history shows before "Show older events". */
export const historyPageSize = 20

function passedText(failedSince: number | null, at: number): string {
  if (failedSince === null) {
    return 'Checks passed.'
  }
  return `Checks passed again, after ${minutesText((at - failedSince) / minuteMs)} of failed checks.`
}

/** The events up to `until`, newest first, each with its sentence. */
export function historyItems(events: StatusEvent[] | undefined, until: number): HistoryItem[] {
  const items: HistoryItem[] = []
  let failedSince: number | null = null
  for (const event of timedEvents(events)) {
    if (event.at > until) {
      break
    }
    if (event.type === 'START') {
      items.push({ at: event.at, kind: 'start', tone: 'neutral', text: 'Monitoring began.' })
      failedSince = null
    } else if (event.type === 'UNHEALTHY') {
      items.push({ at: event.at, kind: 'failed', tone: 'danger', text: 'Checks began failing.' })
      failedSince = event.at
    } else {
      items.push({
        at: event.at,
        kind: 'passed',
        tone: 'success',
        text: passedText(failedSince, event.at),
      })
      failedSince = null
    }
  }
  return items.reverse()
}
