import type { DayKind } from '../../domain/record/record'

import styles from './RecordCalendar.module.css'

export interface LegendProps {
  /** "No record (before 12 Oct, when monitoring began)" */
  noRecord: string
}

const entries: { kind: DayKind; text: string }[] = [
  { kind: 'ok', text: 'No failed checks' },
  { kind: 'minor', text: 'Under 30 minutes of failed checks, or a report' },
  { kind: 'major', text: '30 minutes or more' },
  { kind: 'maintenance', text: 'Maintenance' },
]

const swatchClasses = new Map<DayKind, string | undefined>([
  ['ok', styles.ok],
  ['minor', styles.minor],
  ['major', styles.major],
  ['maintenance', styles.maintenance],
  ['no-record', styles.none],
])

/** What each kind of day looks like, in words beside each swatch. */
export function Legend({ noRecord }: LegendProps) {
  return (
    <ul className={styles.legend ?? ''} aria-label="Legend">
      {[...entries, { kind: 'no-record' as const, text: noRecord }].map((entry) => (
        <li key={entry.kind}>
          <span
            aria-hidden="true"
            className={`${styles.swatch ?? ''} ${swatchClasses.get(entry.kind) ?? ''}`}
          />
          {entry.text}
        </li>
      ))}
    </ul>
  )
}
