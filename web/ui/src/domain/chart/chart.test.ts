import { describe, expect, it } from 'vitest'

import type { ResponseTimeHistory } from '../../api/types'
import { at, event } from '../../test/fixtures'
import { hourMs } from '../time/format'

import { chartModel, quantile, roundMax } from './chart'
import {
  bandBox,
  chartFrame,
  failedBoxes,
  isolatedPoints,
  linePath,
  xTicks,
  yTicks,
} from './geometry'

/** Hourly averages ending at the hour before minute 60, oldest first. */
function hourly(values: number[]): ResponseTimeHistory {
  const last = at(0)
  return {
    timestamps: values.map((_, index) => last - (values.length - 1 - index) * hourMs),
    values,
  }
}

describe('chart numbers', () => {
  it('rounds the axis top up to a round number', () => {
    expect(roundMax(72)).toBe(100)
    expect(roundMax(180)).toBe(200)
    expect(roundMax(240)).toBe(250)
    expect(roundMax(640)).toBe(1000)
    expect(roundMax(5000)).toBe(5000)
    expect(roundMax(0)).toBe(100)
  })

  it('interpolates quantiles', () => {
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20)
    expect(quantile([10, 20], 0.5)).toBe(15)
    expect(quantile([], 0.5)).toBeNull()
  })
})

describe('chartModel', () => {
  it('reads hourly averages, skipping hours with no data', () => {
    const model = chartModel({
      history: hourly([60, 0, 70, 80, 90]),
      range: '24h',
      end: at(1),
      events: [event('START', -3000)],
    })
    expect(model.points.map((point) => point.ms)).toEqual([60, 70, 80, 90])
    expect(model.max).toBe(100)
    expect(model.median).toBe(75)
    expect(model.band).toEqual({ low: 67.5, high: 82.5 })
    expect(model.failed).toEqual([])
    expect(model.description).toBe(
      'Hourly averages over the last 24 hours: median 75 ms; the middle half of hours 68 ms to 83 ms; the slowest hour 90 ms. No failed checks in this period.',
    )
  })

  it('keeps only the chosen period', () => {
    const long = hourly(Array.from({ length: 48 }, () => 50))
    expect(chartModel({ history: long, range: '24h', end: at(1) }).points).toHaveLength(24)
    expect(chartModel({ history: long, range: '7d', end: at(1) }).points).toHaveLength(48)
  })

  it('shades failed periods from the record, clipped to the period', () => {
    const model = chartModel({
      history: hourly([70, 70]),
      range: '24h',
      end: at(60),
      events: [
        event('START', -3000),
        event('UNHEALTHY', -2000),
        event('HEALTHY', -1300),
        event('UNHEALTHY', 40),
      ],
    })
    expect(model.failed).toEqual([
      { from: at(60) - 24 * hourMs, to: at(-1300) },
      { from: at(40), to: at(60) },
    ])
    expect(model.description).toMatch(/Shaded: 2 periods of failed checks\.$/)
    expect(model.rows.at(-1)).toEqual({
      label: '14:00 UTC',
      from: at(60),
      response: null,
      failedMinutes: 0,
    })
    expect(model.rows.find((row) => row.from === at(0))?.failedMinutes).toBe(20)
  })

  it('says nothing about failures while the record loads, and when nothing was recorded', () => {
    const model = chartModel({ history: { timestamps: [], values: [] }, range: '7d', end: at(0) })
    expect(model.failed).toBeNull()
    expect(model.band).toBeNull()
    expect(model.description).toBe('No response times were recorded in the last 7 days.')
    expect(model.rows).toHaveLength(7)
    expect(model.rows.at(-1)).toEqual({
      label: '2 Nov',
      from: at(-13 * 60),
      response: null,
      failedMinutes: 0,
    })
  })

  it('ends at the time-travel moment', () => {
    const model = chartModel({
      history: hourly([70, 75, 80]),
      range: '30d',
      end: at(-50),
      past: true,
    })
    expect(model.points).toHaveLength(2)
    expect(model.description).toMatch(/^Hourly averages over the 30 days to 12:10 UTC:/)
    expect(model.rows).toHaveLength(30)
  })
})

describe('geometry', () => {
  const model = chartModel({
    history: hourly([50, 100, 0, 0, 0, 80]),
    range: '24h',
    end: at(1),
    events: [event('START', -3000), event('UNHEALTHY', -59), event('HEALTHY', -58)],
  })
  const frame = chartFrame(640)

  it('places the axis on the left, from 0 to the top', () => {
    expect(yTicks(model, frame).map((tick) => tick.label)).toEqual(['0 ms', '50 ms', '100 ms'])
    expect(yTicks(model, frame).map((tick) => tick.position)).toEqual([156, 83, 10])
    expect(xTicks(model, frame).map((tick) => tick.label)).toEqual([
      '16:00',
      '22:00',
      '04:00',
      '10:00',
    ])
  })

  it('breaks the line over missing hours', () => {
    const path = linePath(model, frame)
    expect(path.match(/M/g)).toHaveLength(2)
    expect(path.match(/L/g)).toHaveLength(1)
  })

  it('marks a point with no neighbour, which the line cannot show', () => {
    expect(isolatedPoints(model, frame)).toHaveLength(1)
    const alone = { ...model, points: model.points.slice(0, 1) }
    expect(isolatedPoints(alone, frame)).toHaveLength(1)
    expect(isolatedPoints({ ...model, points: [] }, frame)).toEqual([])
  })

  it('draws the band and a visible box for a short failure', () => {
    expect(bandBox(model, frame)?.x).toBe(56)
    const [box] = failedBoxes(model, frame)
    expect(box?.width).toBe(3)
    expect(chartFrame(10).width).toBe(120)
  })
})
