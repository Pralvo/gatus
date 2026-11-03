// Time and duration wording. Pages show UTC, with relative time beside it and
// local time on hover. Nothing here reads the clock: "now" is always passed in.

export const secondMs = 1000
export const minuteMs = 60 * secondMs
export const hourMs = 60 * minuteMs
export const dayMs = 24 * hourMs

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`
}

/** Midnight UTC of the day that holds the time. */
export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / dayMs) * dayMs
}

/** Rounds down to the whole minute. */
export function floorToMinute(ms: number): number {
  return Math.floor(ms / minuteMs) * minuteMs
}

/** "13:50 UTC" */
export function utcClock(ms: number): string {
  const date = new Date(ms)
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`
}

/** "2 Nov" */
export function utcDay(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getUTCDate())} ${months.at(date.getUTCMonth()) ?? ''}`
}

/** "2 Nov 2026" */
export function utcDate(ms: number): string {
  return `${utcDay(ms)} ${String(new Date(ms).getUTCFullYear())}`
}

/** "2 Nov 2026, 13:50 UTC" */
export function utcDateTime(ms: number): string {
  return `${utcDate(ms)}, ${utcClock(ms)}`
}

/**
 * "13:50 UTC" when the time falls on the same UTC day as `reference`, otherwise
 * "2 Nov, 13:50 UTC", so a bare clock time is never read as today by mistake.
 */
export function utcClockNear(ms: number, reference: number): string {
  return startOfUtcDay(ms) === startOfUtcDay(reference)
    ? utcClock(ms)
    : `${utcDay(ms)}, ${utcClock(ms)}`
}

/** "22 minutes", "1 hour", "2 hours 5 minutes", "under a minute" */
export function minutesText(minutes: number): string {
  const whole = Math.round(minutes)
  if (whole < 1) {
    return 'under a minute'
  }
  if (whole < 60) {
    return plural(whole, 'minute')
  }
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`
}

/** "just now", "2 minutes ago", "3 hours ago", "4 days ago", or "in 5 minutes" for a future time. */
export function relativeTime(ms: number, now: number): string {
  const minutes = Math.round(Math.abs(now - ms) / minuteMs)
  if (minutes < 1) {
    return 'just now'
  }
  const hours = Math.round(minutes / 60)
  let amount = plural(Math.round(hours / 24), 'day')
  if (minutes < 60) {
    amount = plural(minutes, 'minute')
  } else if (hours < 48) {
    amount = plural(hours, 'hour')
  }
  return ms > now ? `in ${amount}` : `${amount} ago`
}

export interface LocalTimeOptions {
  /** BCP 47 locale; the browser's when left out. */
  locale?: string
  /** IANA zone; the browser's when left out. */
  timeZone?: string
}

/** The time in the reader's own zone, for a hover title: "2 Nov 2026, 19:20 GMT+5:30". */
export function localTime(ms: number, options: LocalTimeOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  }).format(new Date(ms))
}

/** Below a second in milliseconds, above it in seconds with one decimal: "640 ms", "1.2 s", "5 s". */
export function durationText(ms: number): string {
  const rounded = Math.round(ms)
  if (rounded < secondMs) {
    return `${String(Math.max(rounded, 0))} ms`
  }
  const seconds = (ms / secondMs).toFixed(1).replace(/\.0$/, '')
  return `${seconds} s`
}

/** Converts a Go duration in nanoseconds, as Gatus sends it, to milliseconds. */
export function nanosToMs(nanoseconds: number): number {
  return nanoseconds / 1e6
}
