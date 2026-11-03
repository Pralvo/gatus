import { localTime, relativeTime, utcClockNear } from '../../domain/time/format'

export interface WhenProps {
  /** The time, in Unix milliseconds. */
  ms: number
  /** Now, or the time-travel moment: decides whether the day is named. */
  reference: number
  /** Adds "· 24 minutes ago" beside the UTC time. */
  relative?: boolean
}

/** A time in UTC, with relative time beside it when asked and the reader's local time on hover. */
export function When({ ms, reference, relative = false }: WhenProps) {
  return (
    <time
      className="num"
      dateTime={new Date(ms).toISOString()}
      title={`Your time: ${localTime(ms)}`}
    >
      {utcClockNear(ms, reference)}
      {relative ? ` · ${relativeTime(ms, reference)}` : null}
    </time>
  )
}
