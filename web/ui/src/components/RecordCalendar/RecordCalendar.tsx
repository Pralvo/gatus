import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'

import {
  accuracyCaption,
  dayDetail,
  noRecordCaption,
  recordCaption,
  type DayKind,
  type RecordDay,
  type TrackRecord,
} from '../../domain/record/record'

import { Legend } from './Legend'
import styles from './RecordCalendar.module.css'

export interface DayLink {
  label: string
  to: string
}

export interface RecordCalendarProps {
  record: TrackRecord
  /** The grid's accessible name. */
  label?: string
  /** Controls above the grid, such as the home page's service filter. */
  toolbar?: ReactNode
  /** Links shown under a chosen day, such as "Read the story". */
  links?: (day: RecordDay) => DayLink[]
}

const kindClasses = new Map<DayKind, string | undefined>([
  ['ok', styles.ok],
  ['minor', styles.minor],
  ['major', styles.major],
  ['maintenance', styles.maintenance],
  ['no-record', styles.none],
])

const week = 7

/**
 * The 91-day record: 13 columns of 7 days, newest at the bottom right. The
 * grid is one tab stop; arrows move by a day (up and down) or a week (left
 * and right), Home and End go to the first and last day, and Enter or a
 * click chooses a day, whose detail is read out politely.
 */
export function RecordCalendar({
  record,
  label = 'Daily record, 91 days',
  toolbar,
  links,
}: RecordCalendarProps) {
  const { days } = record
  const last = days.length - 1
  const [active, setActive] = useState(last)
  const [chosen, setChosen] = useState<number | null>(null)
  const cells = useRef(new Map<number, HTMLButtonElement>())
  const chosenDay = chosen === null ? undefined : days.at(chosen)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowUp: active - 1,
      ArrowDown: active + 1,
      ArrowLeft: active - week,
      ArrowRight: active + week,
      Home: 0,
      End: last,
    }
    const target = moves[event.key]
    if (target === undefined) {
      return
    }
    event.preventDefault()
    const next = Math.min(Math.max(target, 0), last)
    setActive(next)
    cells.current.get(next)?.focus()
  }

  return (
    <div>
      <div className={styles.head ?? ''}>
        {toolbar}
        <p className={styles.caption ?? ''}>{recordCaption(record)}</p>
      </div>
      <div role="group" aria-label={label} className={styles.grid ?? ''} onKeyDown={onKeyDown}>
        {days.map((day, index) => (
          <button
            key={day.start}
            ref={(element) => {
              if (element === null) {
                cells.current.delete(index)
              } else {
                cells.current.set(index, element)
              }
            }}
            type="button"
            tabIndex={index === active ? 0 : -1}
            aria-label={dayDetail(day)}
            aria-pressed={index === chosen}
            data-kind={day.kind}
            className={`${styles.day ?? ''} ${kindClasses.get(day.kind) ?? ''} ${
              index === chosen ? (styles.selected ?? '') : ''
            }`}
            onClick={() => {
              setActive(index)
              setChosen(index)
            }}
          />
        ))}
      </div>
      <Legend noRecord={noRecordCaption(record.recordStart)} />
      <div className={styles.detail ?? ''} aria-live="polite">
        {chosenDay === undefined ? (
          <p>Choose a day to see what happened.</p>
        ) : (
          <>
            <p>{dayDetail(chosenDay)}</p>
            <DayLinks links={links?.(chosenDay) ?? []} />
          </>
        )}
      </div>
      <p className={`${styles.caption ?? ''} ${styles.accuracy ?? ''}`}>{accuracyCaption}</p>
    </div>
  )
}

function DayLinks({ links }: { links: DayLink[] }) {
  if (links.length === 0) {
    return null
  }
  return (
    <p className={styles.links ?? ''}>
      {links.map((link) => (
        <Link key={link.to + link.label} to={link.to}>
          {link.label}
        </Link>
      ))}
    </p>
  )
}
