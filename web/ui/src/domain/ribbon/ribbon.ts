// The "At a glance" ribbon on a report page (spec 4.5): when checks failed
// against when the report was open, on one UTC axis with numbered stage ticks.
// Positions are fractions of the axis, 0 to 1, so the picture scales to any
// width without measuring it. The words for the same facts come from
// ribbonText() in story/report.ts; this file only places them.

import type { Report } from '../../api/plugins/types'
import { stageWord } from '../notices/reports'
import type { ReportStory } from '../story/report'
import { dayMs, minuteMs, utcClockNear, utcDay } from '../time/format'

export interface Span {
  /** Fractions of the axis. */
  start: number
  end: number
  /** Still going at the end of the axis' data. */
  open: boolean
}

export interface Tick {
  at: number
  label: string
}

export interface StageTick extends Tick {
  /** 1 for the first update, oldest first, as in ribbonText(). */
  number: number
}

export interface Ribbon {
  from: number
  to: number
  /** Failure periods of the affected services, overlaps joined. */
  failed: Span[]
  report: Span
  stages: StageTick[]
  axis: Tick[]
}

/** Axis steps in minutes, from 5 minutes to 30 days. */
const steps = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080, 43200]
/** The most intervals the axis is split into before a longer step is used. */
const maxIntervals = 4

interface Axis {
  from: number
  to: number
  step: number
}

/** The shortest step whose whole-step axis around [start, end] has at most four intervals. */
function axisFor(start: number, end: number): Axis {
  const fits = (stepMinutes: number): Axis => {
    const step = stepMinutes * minuteMs
    const from = Math.floor((start - minuteMs) / step) * step
    const to = Math.ceil((end + minuteMs) / step) * step
    return { from, to, step }
  }
  const chosen = steps.find((minutes) => {
    const axis = fits(minutes)
    return (axis.to - axis.from) / axis.step <= maxIntervals
  })
  return fits(chosen ?? steps.at(-1) ?? 1)
}

interface Period {
  start: number
  end: number
  open: boolean
}

/** Joins overlapping or touching periods. */
export function joined(periods: Period[]): Period[] {
  const sorted = [...periods].sort((a, b) => a.start - b.start)
  const out: Period[] = []
  for (const period of sorted) {
    const last = out.at(-1)
    if (last !== undefined && period.start <= last.end) {
      if (period.end >= last.end) {
        last.open = period.open || (period.end === last.end && last.open)
        last.end = period.end
      }
    } else {
      out.push({ ...period })
    }
  }
  return out
}

/** Places the report's failures, open span and stages on a UTC axis. */
export function ribbon(report: Report, story: ReportStory, now: number): Ribbon {
  const reportEnd = report.resolvedAt ?? now
  const failures = joined(story.failures)
  const start = Math.min(report.publishedAt, ...failures.map((period) => period.start))
  const end = Math.max(reportEnd, ...failures.map((period) => period.end))
  const { from, to, step } = axisFor(start, end)
  const place = (ms: number) => (ms - from) / (to - from)
  const clock = (ms: number) =>
    step >= dayMs ? utcDay(ms) : utcClockNear(ms, reportEnd).replace(' UTC', '')
  const axis: Tick[] = []
  for (let tick = from; tick <= to; tick += step) {
    axis.push({ at: place(tick), label: clock(tick) })
  }
  const stages = [...report.updates]
    .sort((a, b) => a.at - b.at)
    .map((update, index) => ({
      at: place(update.at),
      number: index + 1,
      label: `${stageWord(update.stage)} ${utcClockNear(update.at, reportEnd)}`,
    }))
  return {
    from,
    to,
    failed: failures.map((period) => ({
      start: place(period.start),
      end: place(period.end),
      open: period.open,
    })),
    report: {
      start: place(report.publishedAt),
      end: place(reportEnd),
      open: report.resolvedAt === undefined,
    },
    stages,
    axis,
  }
}
