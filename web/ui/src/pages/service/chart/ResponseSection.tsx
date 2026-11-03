import { Button, SegmentedControl } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'
import type { UseQueryResult } from '@tanstack/react-query'
import { useId, useState } from 'react'

import type { ResponseTimeHistory, StatusEvent } from '../../../api/types'
import { Section } from '../../../components/PageHead/Section'
import { useResponseTimes } from '../../../data/service'
import {
  chartModel,
  chartRanges,
  type ChartModel,
  type ChartRange,
} from '../../../domain/chart/chart'

import styles from './chart.module.css'
import { ChartFigure } from './ChartFigure'
import { ChartTable } from './ChartTable'

export interface ResponseSectionProps {
  serviceKey: string
  events: StatusEvent[] | undefined
  /** Now, or the time-travel moment: the period ends here. */
  reference: number
  past: boolean
}

/**
 * "Response time": the period switch, the chart with its sentence, and the
 * same numbers as a table on request (spec 4.2 item 5). In time travel the
 * 30-day history is cut to the period ending at the moment.
 */
export function ResponseSection({ serviceKey, events, reference, past }: ResponseSectionProps) {
  const [range, setRange] = useState<ChartRange>('24h')
  const [asTable, setAsTable] = useState(false)
  const describedBy = useId()
  const history = useResponseTimes(serviceKey, past ? '30d' : range, {
    live: !past,
    enabled: true,
  })
  const model = chartModel({
    history: history.data,
    range,
    end: reference,
    ...(events === undefined ? {} : { events }),
    past,
  })
  const switcher = (
    <SegmentedControl
      aria-label="Period"
      size="small"
      onChange={(index) => {
        setRange(chartRanges.at(index)?.range ?? '24h')
      }}
    >
      {chartRanges.map((entry) => (
        <SegmentedControl.Button key={entry.range} selected={entry.range === range}>
          {entry.label}
        </SegmentedControl.Button>
      ))}
    </SegmentedControl>
  )
  return (
    <Section id="response-heading" title="Response time" aside={switcher}>
      <ChartBody
        history={history}
        model={model}
        asTable={asTable}
        describedBy={describedBy}
        onToggle={() => {
          setAsTable((shown) => !shown)
        }}
      />
    </Section>
  )
}

interface ChartBodyProps {
  history: UseQueryResult<ResponseTimeHistory>
  model: ChartModel
  asTable: boolean
  describedBy: string
  onToggle: () => void
}

/** The chart or its table, the sentence and the toggle; a skeleton or a retry until the data is in. */
function ChartBody({ history, model, asTable, describedBy, onToggle }: ChartBodyProps) {
  if (history.data === undefined && history.isError) {
    return (
      <div className={styles.box ?? ''}>
        <p className={styles.description ?? ''}>Response times could not be loaded.</p>
        <Button size="small" className={styles.toggle ?? ''} onClick={() => void history.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  if (history.data === undefined) {
    return (
      <div className={styles.box ?? ''} aria-busy="true">
        <SkeletonText lines={3} />
      </div>
    )
  }
  return (
    <>
      {asTable ? (
        <ChartTable model={model} />
      ) : (
        <div className={styles.box ?? ''}>
          <ChartFigure model={model} describedBy={describedBy} />
        </div>
      )}
      <p className={styles.description ?? ''} id={describedBy}>
        {model.description}
      </p>
      <Button size="small" className={styles.toggle ?? ''} onClick={onToggle}>
        {asTable ? 'Show as chart' : 'Show as table'}
      </Button>
      <p className={styles.note ?? ''}>
        The grey band is the middle half of the hourly averages in the period. Shaded areas are
        periods of failed checks.
      </p>
    </>
  )
}
