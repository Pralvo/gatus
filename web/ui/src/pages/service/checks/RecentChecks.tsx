import { ChevronLeftIcon, ChevronRightIcon } from '@primer/octicons-react'
import { Button } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'
import { useState } from 'react'

import type { Result } from '../../../api/types'
import { CheckStrip } from '../../../components/CheckStrip/CheckStrip'
import { Section } from '../../../components/PageHead/Section'
import { stateIcon } from '../../../components/StatusWord/icons'
import { StatusWord } from '../../../components/StatusWord/StatusWord'
import { usePageConfig } from '../../../config/context'
import { useCheckPage } from '../../../data/service'
import {
  checkRows,
  checksPageSize,
  hasOlderPage,
  pageCaption,
  type CheckRow,
} from '../../../domain/checks/table'
import { localTime } from '../../../domain/time/format'

import styles from './checks.module.css'

export interface RecentChecksProps {
  serviceKey: string
  name: string
  /** The results the strip shows. */
  results: Result[]
  reference: number
  past: boolean
  stale: boolean
}

interface Paged {
  rows: CheckRow[]
  older: boolean
  loading: boolean
  failed: boolean
  retry: () => void
}

type PageSource = Pick<RecentChecksProps, 'serviceKey' | 'results' | 'reference' | 'past'>

/** Now: Gatus's own result pages. In time travel: the kept checks up to the moment, 50 at a time. */
function usePagedRows(props: PageSource, page: number): Paged {
  const { maximumNumberOfResults } = usePageConfig()
  const query = useCheckPage(props.serviceKey, page, { live: !props.past, enabled: !props.past })
  if (props.past) {
    const all = checkRows(props.results, props.reference)
    const start = (page - 1) * checksPageSize
    return {
      rows: all.slice(start, start + checksPageSize),
      older: all.length > start + checksPageSize,
      loading: false,
      failed: false,
      retry: () => undefined,
    }
  }
  const results = query.data?.results ?? []
  return {
    rows: checkRows(results, props.reference, Number.POSITIVE_INFINITY),
    older: hasOlderPage(page, results.length, maximumNumberOfResults),
    loading: query.data === undefined && !query.isError,
    failed: query.isError,
    retry: () => void query.refetch(),
  }
}

function ChecksTable({ rows, page }: { rows: CheckRow[]; page: number }) {
  return (
    <div className={styles.tableBox ?? ''}>
      <table className={`${styles.table ?? ''} num`}>
        <caption className={styles.caption ?? ''}>
          {pageCaption(page, rows.length)} Times in UTC.
        </caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Result</th>
            <th scope="col">Response</th>
            <th scope="col">Why it failed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.at}>
              <td data-label="Time">
                <time
                  dateTime={new Date(row.at).toISOString()}
                  title={`Your time: ${localTime(row.at)}`}
                >
                  {row.time}
                </time>
              </td>
              <td data-label="Result">
                <StatusWord
                  tone={row.result === 'Passed' ? 'success' : 'danger'}
                  icon={stateIcon(row.result === 'Passed' ? 'working' : 'failed')}
                >
                  {row.result}
                </StatusWord>
              </td>
              <td data-label="Response">{row.response}</td>
              <td data-label="Why it failed" className={styles.why ?? ''}>
                {row.why ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Recent checks": the strip, then the newest checks as a table, 50 to a page (spec 4.2 item 6). */
export function RecentChecks(props: RecentChecksProps) {
  const [page, setPage] = useState(1)
  const { serviceKey, results, reference, past } = props
  const paged = usePagedRows({ serviceKey, results, reference, past }, page)
  let table = (
    <div className={styles.tableBox ?? ''} aria-busy="true">
      <SkeletonText lines={4} />
    </div>
  )
  if (paged.failed && paged.rows.length === 0) {
    table = (
      <div className={styles.tableBox ?? ''}>
        <p className={styles.message ?? ''}>These checks could not be loaded.</p>
        <Button size="small" onClick={paged.retry}>
          Try again
        </Button>
      </div>
    )
  } else if (!paged.loading) {
    table = <ChecksTable rows={paged.rows} page={page} />
  }
  return (
    <Section id="checks-heading" title="Recent checks">
      <div className={styles.stripBox ?? ''}>
        <CheckStrip
          name={props.name}
          results={props.results}
          reference={props.reference}
          past={props.past}
          dimmed={props.stale}
        />
      </div>
      {table}
      <nav className={styles.pager ?? ''} aria-label="Pages of checks">
        <Button
          size="small"
          leadingVisual={ChevronLeftIcon}
          disabled={page === 1}
          onClick={() => {
            setPage((current) => Math.max(1, current - 1))
          }}
        >
          Newer checks
        </Button>
        <Button
          size="small"
          trailingVisual={ChevronRightIcon}
          disabled={!paged.older || paged.loading}
          onClick={() => {
            setPage((current) => current + 1)
          }}
        >
          Older checks
        </Button>
      </nav>
    </Section>
  )
}
