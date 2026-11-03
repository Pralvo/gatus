import type { Ribbon, Span } from '../../../../domain/ribbon/ribbon'

import styles from './ribbon.module.css'

export type FailuresKnown = 'known' | 'loading' | 'failed'

export interface RibbonFigureProps {
  picture: Ribbon
  /** ribbonText(): the same facts in words. */
  lines: string[]
  /** Whether the affected services' events have loaded. */
  failures: FailuresKnown
}

/** A fraction of the axis as an SVG length. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`
}

/** Even a one-minute span stays visible. */
function width(span: Span): string {
  return pct(Math.max(span.end - span.start, 0.004))
}

const failedRow = { label: 14, top: 20 }
const reportRow = { label: 58, top: 64 }
const rowHeight = 18
const axisY = 92

function anchorOf(index: number, count: number): 'start' | 'middle' | 'end' {
  if (index === 0) {
    return 'start'
  }
  return index === count - 1 ? 'end' : 'middle'
}

function noFailuresText(failures: FailuresKnown): string {
  if (failures === 'loading') {
    return 'Loading check events…'
  }
  return failures === 'failed' ? 'Check events could not be loaded' : 'No failed checks measured'
}

/**
 * "At a glance" (spec 4.5): failed checks (solid) against the time the report
 * was open (outline), with numbered stage ticks on a UTC axis. The picture is
 * hidden from screen readers; the list under it says the same in words.
 */
export function RibbonFigure({ picture, lines, failures }: RibbonFigureProps) {
  const missing = failures !== 'known'
  return (
    <div>
      <svg className={styles.ribbon ?? ''} aria-hidden="true" focusable="false">
        <text x="0" y={failedRow.label}>
          Failed checks
        </text>
        {picture.failed.map((span) => (
          <rect
            key={span.start}
            className={styles.failed ?? ''}
            x={pct(span.start)}
            y={failedRow.top}
            width={width(span)}
            height={rowHeight}
            rx="3"
          />
        ))}
        {picture.failed.length === 0 ? (
          <text x="0" y={failedRow.top + 13} className={styles.note ?? ''}>
            {noFailuresText(failures)}
          </text>
        ) : null}
        <text x="0" y={reportRow.label}>
          Report open
        </text>
        <rect
          className={styles.open ?? ''}
          x={pct(picture.report.start)}
          y={reportRow.top}
          width={width(picture.report)}
          height={rowHeight}
          rx="3"
        />
        {picture.stages.map((stage) => (
          <g key={stage.number}>
            <line
              className={styles.stage ?? ''}
              x1={pct(stage.at)}
              x2={pct(stage.at)}
              y1={reportRow.top - 2}
              y2={reportRow.top + rowHeight + 2}
            />
            <text className={styles.number ?? ''} x={pct(stage.at)} dx="3" y={reportRow.top + 14}>
              {stage.number}
            </text>
          </g>
        ))}
        <line className={styles.axis ?? ''} x1="0" x2="100%" y1={axisY} y2={axisY} />
        {picture.axis.map((tick, index) => (
          <g key={tick.at}>
            <line
              className={styles.axis ?? ''}
              x1={pct(tick.at)}
              x2={pct(tick.at)}
              y1={axisY}
              y2={axisY + 6}
            />
            <text x={pct(tick.at)} y={axisY + 22} textAnchor={anchorOf(index, picture.axis.length)}>
              {tick.label}
            </text>
          </g>
        ))}
      </svg>
      <ul className={styles.lines ?? ''}>
        {missing ? (
          <li>
            Failed checks (measured):{' '}
            {failures === 'loading'
              ? 'loading the check events.'
              : 'the check events could not be loaded.'}
          </li>
        ) : null}
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>Times in UTC.</li>
      </ul>
    </div>
  )
}
