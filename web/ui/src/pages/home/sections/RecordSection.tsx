import { FormControl, Select } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'
import { useState } from 'react'

import { RecordCalendar, type DayLink } from '../../../components/RecordCalendar/RecordCalendar'
import { buildRecord, type RecordDay } from '../../../domain/record/record'
import { atParam } from '../../../domain/time/at'
import { utcClock } from '../../../domain/time/format'
import home from '../home.module.css'
import type { HomeView } from '../useHomeView'

const all = 'all'

/** "Read the story" for each report a day names, "See the page at 13:50 UTC" for each failure. */
export function dayLinks(day: RecordDay): DayLink[] {
  const links = new Map<string, DayLink>()
  for (const item of day.items) {
    if (item.kind === 'failed') {
      for (const ref of item.reports) {
        links.set(`/reports/${ref.id}`, {
          label: 'Read the story',
          to: `/reports/${encodeURIComponent(ref.id)}`,
        })
      }
      const at = `/?at=${atParam(item.seeAt)}`
      links.set(at, { label: `See the page at ${utcClock(item.seeAt)}`, to: at })
    } else if (item.kind === 'report') {
      links.set(`/reports/${item.id}`, {
        label: 'Read the story',
        to: `/reports/${encodeURIComponent(item.id)}`,
      })
    }
  }
  return [...links.values()]
}

/** "Track record": the calendar with its service filter (spec 4.1 item 6, 4.7). Past notices follow it. */
export function RecordSection({ view }: { view: HomeView }) {
  const [filter, setFilter] = useState(all)
  const known = view.inputs.some((input) => input.key === filter)
  const chosen = known ? filter : all
  const record = buildRecord({
    services: view.inputs.map((input) => ({
      key: input.key,
      name: input.name,
      ...(input.events === undefined ? {} : { events: input.events }),
    })),
    reports: view.reports,
    windows: view.windows,
    end: view.reference,
    filter: chosen === all ? null : chosen,
  })
  return (
    <section id="record" className={home.part ?? ''} aria-labelledby="record-heading">
      <h2 id="record-heading" className={home.h2 ?? ''} tabIndex={-1}>
        Track record
      </h2>
      <p className={home.sub ?? ''}>The worst state of each day. Choose a day for what happened.</p>
      <div className={`${home.box ?? ''} ${home.padded ?? ''}`}>
        {!view.eventsLoading ? (
          <RecordCalendar
            key={chosen}
            record={record}
            links={dayLinks}
            toolbar={
              <FormControl>
                <FormControl.Label>Show</FormControl.Label>
                <Select
                  value={chosen}
                  onChange={(event) => {
                    setFilter(event.target.value)
                  }}
                >
                  <Select.Option value={all}>All services</Select.Option>
                  {view.inputs.map((input) => (
                    <Select.Option key={input.key} value={input.key}>
                      {input.name}
                    </Select.Option>
                  ))}
                </Select>
              </FormControl>
            }
          />
        ) : (
          <div aria-busy="true">
            <SkeletonText lines={3} />
          </div>
        )}
      </div>
    </section>
  )
}
