import type { ChartModel } from '../../../domain/chart/chart'
import { minutesText } from '../../../domain/time/format'

import styles from './chart.module.css'

function failedText(model: ChartModel, minutes: number): string {
  if (model.failed === null) {
    return 'Not known yet'
  }
  return minutes === 0 ? 'None' : minutesText(minutes)
}

/** The chart as a table: one row per hour for a day, one per day for longer periods. */
export function ChartTable({ model }: { model: ChartModel }) {
  const hourly = model.range === '24h'
  return (
    // The table scrolls inside its box, so the box takes focus for keyboard scrolling.
    <div
      className={styles.tableBox ?? ''}
      role="region"
      aria-label="Response times as a table"
      tabIndex={0}
    >
      <table className={`${styles.table ?? ''} num`}>
        <caption className={styles.caption ?? ''}>
          {hourly
            ? 'Each hour’s average response time, and minutes of failed checks. Times in UTC.'
            : 'Each day’s median of hourly averages, and minutes of failed checks. Days in UTC.'}
        </caption>
        <thead>
          <tr>
            <th scope="col">{hourly ? 'Hour' : 'Day'}</th>
            <th scope="col">Response</th>
            <th scope="col">Failed checks</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.from}>
              <th scope="row">{row.label}</th>
              <td>{row.response ?? 'No data'}</td>
              <td>{failedText(model, row.failedMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
