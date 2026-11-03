import { CopyIcon } from '@primer/octicons-react'
import { Button, FormControl, Textarea } from '@primer/react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { Report } from '../../../api/plugins/types'
import { atLink } from '../../../domain/time/at'
import { utcDateTime } from '../../../domain/time/format'
import { firstSeenAt } from '../../../domain/travel/ticket'
import commonStyles from '../common/common.module.css'
import { StageLabel } from '../common/StageLabel'

import styles from './report.module.css'

export interface StagePanelProps {
  report: Report
  /** stageSentence() for the report. */
  sentence: string
  /** Builds "Copy for a ticket" at the moment of the click. */
  ticket: () => string
  origin: string
}

type CopyState = 'idle' | 'copied' | 'failed'

/** The stage in words, the stage sentence, "Copy for a ticket" and the time-travel link. */
export function StagePanel({ report, sentence, ticket, origin }: StagePanelProps) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const [text, setText] = useState('')
  const seenAt = firstSeenAt(report)
  const onCopy = async () => {
    const value = ticket()
    setText(value)
    try {
      await navigator.clipboard.writeText(value)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }
  return (
    <section aria-label="Stage" className={`${commonStyles.box ?? ''} ${styles.panel ?? ''}`}>
      <p className={styles.stage ?? ''}>
        <StageLabel stage={report.stage} size="large" />
      </p>
      <p className={styles.sentence ?? ''}>{sentence}</p>
      <div className={styles.actions ?? ''}>
        <Button leadingVisual={CopyIcon} onClick={() => void onCopy()}>
          Copy for a ticket
        </Button>
        <Link to={atLink(origin, seenAt)}>See the status page at {utcDateTime(seenAt)}</Link>
      </div>
      <p role="status" className={`${commonStyles.muted ?? ''} ${styles.status ?? ''}`}>
        {copy === 'copied' ? 'Copied the text for a ticket.' : ''}
        {copy === 'failed' ? 'Your browser did not allow copying. Select the text below.' : ''}
      </p>
      {copy === 'failed' ? (
        <FormControl>
          <FormControl.Label>Text for a ticket</FormControl.Label>
          <Textarea value={text} readOnly block rows={6} resize="vertical" />
        </FormControl>
      ) : null}
    </section>
  )
}
