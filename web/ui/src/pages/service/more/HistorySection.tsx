import { CheckCircleIcon, PlayIcon, XCircleIcon, type Icon } from '@primer/octicons-react'
import { Button, Label, Timeline } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'
import { useState } from 'react'

import type { StatusEvent } from '../../../api/types'
import { Section } from '../../../components/PageHead/Section'
import { When } from '../../../components/When/When'
import { historyItems, historyPageSize, type HistoryKind } from '../../../domain/history/history'

import styles from './more.module.css'

const icons: Record<HistoryKind, Icon> = {
  start: PlayIcon,
  failed: XCircleIcon,
  passed: CheckCircleIcon,
}

export interface HistorySectionProps {
  events: StatusEvent[] | undefined
  loading: boolean
  reference: number
}

/** "History": when checks started and stopped failing, newest first, from Gatus's events (spec 4.2 item 8). */
export function HistorySection({ events, loading, reference }: HistorySectionProps) {
  const [shown, setShown] = useState(historyPageSize)
  const items = historyItems(events, reference)
  let body = (
    <div aria-busy="true">
      <SkeletonText lines={3} />
    </div>
  )
  if (!loading && events === undefined) {
    body = <p className={styles.text ?? ''}>The history could not be loaded.</p>
  } else if (!loading && items.length === 0) {
    body = <p className={styles.text ?? ''}>No events are kept yet.</p>
  } else if (!loading) {
    body = (
      <>
        <Timeline clipSidebar>
          {items.slice(0, shown).map((item) => {
            const Glyph = icons[item.kind]
            return (
              <Timeline.Item key={`${String(item.at)}-${item.kind}`} condensed>
                <Timeline.Badge>
                  <Glyph aria-hidden="true" className={styles[`tone-${item.tone}`] ?? ''} />
                </Timeline.Badge>
                <Timeline.Body>
                  <span className={styles.meta ?? ''}>
                    <Label variant="secondary">Measured</Label>
                    <When ms={item.at} reference={reference} />
                  </span>
                  <span className={styles.itemText ?? ''}>{item.text}</span>
                </Timeline.Body>
              </Timeline.Item>
            )
          })}
        </Timeline>
        {items.length > shown ? (
          <Button
            size="small"
            onClick={() => {
              setShown((count) => count + historyPageSize)
            }}
          >
            Show older events
          </Button>
        ) : null}
      </>
    )
  }
  return (
    <Section id="history-heading" title="History">
      <p className={styles.sub ?? ''}>When checks started and stopped failing, newest first.</p>
      <div className={styles.box ?? ''}>{body}</div>
    </Section>
  )
}
