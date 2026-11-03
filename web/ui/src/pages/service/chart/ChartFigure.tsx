import type { ChartModel } from '../../../domain/chart/chart'
import {
  bandBox,
  chartFrame,
  chartHeight,
  failedBoxes,
  linePath,
  xTicks,
  yTicks,
} from '../../../domain/chart/geometry'

import styles from './chart.module.css'
import { useWidth } from './useWidth'

export interface ChartFigureProps {
  model: ChartModel
  /** The id of the sentence that describes the chart, which names it. */
  describedBy: string
}

/**
 * The response-time chart: a 56 px axis on the left, the grey band for the
 * middle half, failed periods shaded with a dashed edge, and the line. Drawn
 * only from Primer and Pralvo tokens.
 */
export function ChartFigure({ model, describedBy }: ChartFigureProps) {
  const [ref, width] = useWidth<HTMLDivElement>(640)
  const frame = chartFrame(width)
  const band = bandBox(model, frame)
  const bottom = frame.height - frame.bottom
  return (
    <div ref={ref} className={styles.figure ?? ''}>
      <svg
        role="img"
        aria-labelledby={describedBy}
        viewBox={`0 0 ${String(frame.width)} ${String(chartHeight)}`}
        width={frame.width}
        height={chartHeight}
        className={styles.svg ?? ''}
      >
        {band === null ? null : <rect className={styles.band ?? ''} {...band} />}
        {yTicks(model, frame).map((tick) => (
          <g key={tick.label}>
            <line
              className={styles.grid ?? ''}
              x1={frame.left}
              x2={frame.width - frame.right}
              y1={tick.position}
              y2={tick.position}
            />
            <text
              className={styles.tick ?? ''}
              x={frame.left - 6}
              y={tick.position + 4}
              textAnchor="end"
            >
              {tick.label}
            </text>
          </g>
        ))}
        {failedBoxes(model, frame).map((box) => (
          <g key={box.x} data-failed="">
            <rect className={styles.failed ?? ''} {...box} />
            <line
              className={styles.failedEdge ?? ''}
              x1={box.x}
              x2={box.x}
              y1={box.y}
              y2={bottom}
            />
          </g>
        ))}
        <path className={styles.line ?? ''} d={linePath(model, frame)} />
        {xTicks(model, frame).map((tick) => (
          <text
            key={tick.position}
            className={styles.tick ?? ''}
            x={tick.position}
            y={frame.height - 6}
            textAnchor="middle"
          >
            {tick.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
