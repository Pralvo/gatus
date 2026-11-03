import { Banner, Heading, Spinner } from '@primer/react'
import { Link, useSearchParams } from 'react-router'

import type { Report } from '../../../api/plugins/types'
import { usePageConfig } from '../../../config/context'
import { useNow } from '../../../data/cycle'
import { isNotFound, useReportsPage } from '../../../data/service'
import { refreshFailedMessage } from '../../../domain/freshness/refresh'
import { groupReports, reportsPageParam } from '../../../domain/notices/reports'
import commonStyles from '../common/common.module.css'
import { usePageArrival } from '../common/usePageArrival'

import styles from './list.module.css'
import { ReportSummary } from './ReportSummary'

export const unavailableMessage =
  'Reports are unavailable right now. Service checks on the status page are not affected.'

function Group({ title, reports, now }: { title: string; reports: Report[]; now: number }) {
  if (reports.length === 0) {
    return null
  }
  const id = `reports-${title.toLowerCase()}`
  return (
    <section className={commonStyles.section ?? ''} aria-labelledby={id}>
      <Heading as="h2" id={id} className={commonStyles.h2 ?? ''}>
        {title}
      </Heading>
      <ul className={styles.list ?? ''}>
        {reports.map((report) => (
          <ReportSummary key={report.id} report={report} now={now} />
        ))}
      </ul>
    </section>
  )
}

function Feeds() {
  const { feeds } = usePageConfig()
  if (!feeds) {
    return null
  }
  return (
    <p className={styles.feeds ?? ''}>
      Subscribe: <a href="/feed/atom.xml">Atom</a> · <a href="/feed/rss.xml">RSS</a> ·{' '}
      <a href="/feed/feed.json">JSON Feed</a>
    </p>
  )
}

interface ListState {
  page: number
  now: number
  reports: Report[]
  loading: boolean
  /** Nothing loaded and the request failed. */
  failed: boolean
  /** Shown above loaded data when the latest refresh failed. */
  stale: string | null
  retry: () => void
}

function ListBody({ page, now, reports, loading, failed, stale, retry }: ListState) {
  if (loading) {
    return (
      <p className={commonStyles.muted ?? ''}>
        <Spinner size="small" srText={null} /> Loading reports…
      </p>
    )
  }
  if (failed) {
    return (
      <Banner
        variant="critical"
        title="Reports unavailable"
        hideTitle
        description={unavailableMessage}
        primaryAction={<Banner.PrimaryAction onClick={retry}>Try again</Banner.PrimaryAction>}
      />
    )
  }
  if (reports.length === 0) {
    return page === 1 ? (
      <p>No reports have been published.</p>
    ) : (
      <p>
        There are no reports on this page. <Link to="/reports">See the newest reports</Link>
      </p>
    )
  }
  const groups = groupReports(reports)
  return (
    <>
      {stale === null ? null : (
        <Banner variant="warning" title="Not refreshed" hideTitle description={stale} />
      )}
      <Group title="Active" reports={groups.active} now={now} />
      <Group title="Past" reports={groups.past} now={now} />
    </>
  )
}

function Paging({ page, more }: { page: number; more: boolean }) {
  if (page === 1 && !more) {
    return null
  }
  return (
    <nav aria-label="Pages of reports" className={styles.paging ?? ''}>
      {page > 1 ? (
        <Link to={page === 2 ? '/reports' : `/reports?page=${String(page - 1)}`}>
          Newer reports
        </Link>
      ) : (
        <span />
      )}
      {more ? <Link to={`/reports?page=${String(page + 1)}`}>Older reports</Link> : null}
    </nav>
  )
}

/** /reports?page=n (spec 4.4): open reports, then past ones, newest change first. */
export function ReportsPage() {
  const { header } = usePageConfig()
  const [params] = useSearchParams()
  const page = reportsPageParam(params.get('page'))
  const query = useReportsPage(page)
  const now = useNow()
  const heading = usePageArrival(`Reports · ${header}`, !query.isPending)
  // A server without the reports plugin answers 404: it has published nothing.
  const missing = query.isError && isNotFound(query.error)
  const loaded = missing ? undefined : query.data
  const state: ListState = {
    page,
    now,
    reports: loaded?.reports ?? [],
    loading: query.isPending,
    failed: !query.isPending && !missing && loaded === undefined,
    stale:
      loaded !== undefined && query.isError
        ? refreshFailedMessage({ lastSuccessAt: query.dataUpdatedAt, failuresInRow: 1 }, now)
        : null,
    retry: () => void query.refetch(),
  }
  return (
    <>
      <Heading as="h1" ref={heading} tabIndex={-1} className={commonStyles.h1 ?? ''}>
        Reports
      </Heading>
      <Feeds />
      <ListBody {...state} />
      <Paging page={page} more={loaded?.more === true} />
    </>
  )
}
