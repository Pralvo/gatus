// Where the chart's marks go (spec 4.2 item 5): a 56 px left axis, the line
// broken where hours are missing, the band and the failed periods. Pure maths,
// so the drawing component only places what this returns.

import { durationText, hourMs, utcClock, utcDay } from '../time/format'

import type { ChartModel } from './chart'

export const chartHeight = 180

export interface Frame {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}

/** The drawing area for a width; the axis takes 56 px on the left. */
export function chartFrame(width: number): Frame {
  return {
    width: Math.max(width, 120),
    height: chartHeight,
    left: 56,
    right: 8,
    top: 10,
    bottom: 24,
  }
}

export function xOf(model: ChartModel, frame: Frame, at: number): number {
  const share = (at - model.start) / Math.max(model.end - model.start, 1)
  return frame.left + (frame.width - frame.left - frame.right) * Math.min(Math.max(share, 0), 1)
}

export function yOf(model: ChartModel, frame: Frame, ms: number): number {
  const share = Math.min(Math.max(ms / model.max, 0), 1)
  return frame.top + (frame.height - frame.top - frame.bottom) * (1 - share)
}

const round = (value: number) => value.toFixed(1)

/** The line's path. A gap of more than two hours between points starts a new piece. */
export function linePath(model: ChartModel, frame: Frame): string {
  return model.points
    .map((point, index) => {
      const previous = model.points.at(index - 1)
      const jump = index === 0 || previous === undefined || point.at - previous.at > 2 * hourMs
      return `${jump ? 'M' : 'L'}${round(xOf(model, frame, point.at))} ${round(yOf(model, frame, point.ms))}`
    })
    .join(' ')
}

/** Points with no neighbour within two hours. A path draws nothing for them, so
 * the chart marks each with a dot. */
export function isolatedPoints(model: ChartModel, frame: Frame): { x: number; y: number }[] {
  const { points } = model
  const near = (other: ChartModel['points'][number] | undefined, at: number) =>
    other !== undefined && Math.abs(at - other.at) <= 2 * hourMs
  return points
    .filter((point, index) => {
      const before = index > 0 ? points[index - 1] : undefined
      return !near(before, point.at) && !near(points[index + 1], point.at)
    })
    .map((point) => ({ x: xOf(model, frame, point.at), y: yOf(model, frame, point.ms) }))
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The grey band for the middle half; null with no points. */
export function bandBox(model: ChartModel, frame: Frame): Box | null {
  if (model.band === null) {
    return null
  }
  const top = yOf(model, frame, model.band.high)
  return {
    x: frame.left,
    y: top,
    width: frame.width - frame.left - frame.right,
    height: Math.max(1, yOf(model, frame, model.band.low) - top),
  }
}

/** One box per failed period, at least 3 px wide so a short failure still shows. */
export function failedBoxes(model: ChartModel, frame: Frame): Box[] {
  return (model.failed ?? []).map((period) => {
    const x = xOf(model, frame, period.from)
    const end = Math.max(xOf(model, frame, period.to), x + 3)
    return { x, y: frame.top, width: end - x, height: frame.height - frame.top - frame.bottom }
  })
}

export interface Tick {
  position: number
  label: string
}

/** The axis labels on the left: 0, half and the top. */
export function yTicks(model: ChartModel, frame: Frame): Tick[] {
  return [0, model.max / 2, model.max].map((ms) => ({
    position: yOf(model, frame, ms),
    label: durationText(ms),
  }))
}

/** Four time labels along the bottom: hours for a day, dates for longer. */
export function xTicks(model: ChartModel, frame: Frame): Tick[] {
  const span = model.end - model.start
  return [0, 1, 2, 3].map((index) => {
    const nominal = model.start + (span * (index + 0.5)) / 4
    // Hour labels sit on whole hours, so "16:00" is where 16:00 is.
    const at = model.range === '24h' ? Math.round(nominal / hourMs) * hourMs : nominal
    return {
      position: xOf(model, frame, at),
      label: model.range === '24h' ? utcClock(at).replace(' UTC', '') : utcDay(at),
    }
  })
}
