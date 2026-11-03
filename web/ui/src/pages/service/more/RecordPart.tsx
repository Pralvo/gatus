import { SkeletonText } from '@primer/react/experimental'

import { Section } from '../../../components/PageHead/Section'
import { RecordCalendar, type DayLink } from '../../../components/RecordCalendar/RecordCalendar'
import { buildRecord, type RecordDay } from '../../../domain/record/record'
import { atParam } from '../../../domain/time/at'
import { utcClock } from '../../../domain/time/format'
import type { ServiceView } from '../useServiceView'

import styles from './more.module.css'

/** The reports a day's item names. */
function reportsOf(item: RecordDay['items'][number]): { id: string; title: string }[] {
  if (item.kind === 'failed') {
    return item.reports
  }
  return item.kind === 'report' ? [{ id: item.id, title: item.title }] : []
}

/** "Read the story" for each report a day names, "See the page at 13:50 UTC" for each failure. */
function dayLinks(serviceKey: string) {
  return (day: RecordDay): DayLink[] => {
    const links = new Map<string, DayLink>()
    for (const item of day.items) {
      const reports = reportsOf(item)
      for (const ref of reports) {
        const to = `/reports/${encodeURIComponent(ref.id)}`
        links.set(to, { label: 'Read the story', to })
      }
      if (item.kind === 'failed') {
        const to = `/endpoints/${encodeURIComponent(serviceKey)}?at=${atParam(item.seeAt)}`
        links.set(to, { label: `See this service at ${utcClock(item.seeAt)}`, to })
      }
    }
    return [...links.values()]
  }
}

/** "Record": the 91-day calendar for this service only (spec 4.2 item 7 and 4.7). */
export function RecordPart({ view }: { view: ServiceView }) {
  const input = view.ready?.input
  if (input === undefined) {
    return null
  }
  const record = buildRecord({
    services: [
      {
        key: input.key,
        name: input.name,
        ...(input.events === undefined ? {} : { events: input.events }),
      },
    ],
    reports: view.reports,
    windows: view.windows,
    end: view.reference,
    filter: input.key,
  })
  return (
    <Section id="record-heading" title="Record">
      <div className={styles.box ?? ''}>
        {view.eventsLoading ? (
          <div aria-busy="true">
            <SkeletonText lines={3} />
          </div>
        ) : (
          <RecordCalendar
            record={record}
            label={`Daily record of ${input.name}, 91 days`}
            links={dayLinks(input.key)}
          />
        )}
      </div>
    </Section>
  )
}
