import { localTime, relativeTime, utcDateTime } from '../../../domain/time/format'

import styles from './common.module.css'

export interface UtcTimeProps {
  ms: number
  now: number
}

/** "2 Nov 2026, 14:20 UTC (3 hours ago)", with the reader's local time on hover. */
export function UtcTime({ ms, now }: UtcTimeProps) {
  return (
    <>
      <time className="num" dateTime={new Date(ms).toISOString()} title={localTime(ms)}>
        {utcDateTime(ms)}
      </time>{' '}
      <span className={styles.muted ?? ''}>({relativeTime(ms, now)})</span>
    </>
  )
}
