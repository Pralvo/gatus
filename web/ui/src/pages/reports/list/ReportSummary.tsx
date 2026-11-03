import { Heading } from '@primer/react'
import { Link } from 'react-router'

import type { Report } from '../../../api/plugins/types'
import { AffectedList } from '../common/AffectedList'
import commonStyles from '../common/common.module.css'
import { StageLabel } from '../common/StageLabel'
import { UtcTime } from '../common/UtcTime'

import styles from './list.module.css'

export interface ReportSummaryProps {
  report: Report
  now: number
  /** The title's heading level: 3 under "Active", 4 under a month of "Past". */
  level: 3 | 4
}

/** One report in the list: title link, stage, last change, latest update and services. */
export function ReportSummary({ report, now, level }: ReportSummaryProps) {
  const latest = report.updates[0]
  return (
    <li className={styles.item ?? ''}>
      <Heading as={level === 3 ? 'h3' : 'h4'} className={styles.title ?? ''}>
        <Link to={`/reports/${encodeURIComponent(report.id)}`}>{report.title}</Link>
      </Heading>
      <p className={styles.meta ?? ''}>
        <StageLabel stage={report.stage} />
        <span>
          Updated <UtcTime ms={report.updatedAt} now={now} />
        </span>
      </p>
      {latest === undefined ? null : (
        <p className={`${commonStyles.text ?? ''} ${styles.latest ?? ''}`}>{latest.message}</p>
      )}
      <AffectedList endpoints={report.endpoints} />
    </li>
  )
}
