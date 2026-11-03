import { Banner, Button, Heading, Spinner } from '@primer/react'
import { useSearchParams } from 'react-router'

import type { Report } from '../../../api/plugins/types'
import { NoticeFilters } from '../../../components/NoticeFilters/NoticeFilters'
import { usePageConfig } from '../../../config/context'
import { useNow } from '../../../data/cycle'
import { useReportPages, type ReportPages } from '../../../data/service'
import { searchWords } from '../../../domain/browse/filter'
import { shownFrom, utcMonth, type Month } from '../../../domain/browse/months'
import { browseReports } from '../../../domain/browse/pages'
import { readBrowseQuery, writeBrowseQuery, type BrowseQuery } from '../../../domain/browse/query'
import { refreshFailedMessage } from '../../../domain/freshness/refresh'
import commonStyles from '../common/common.module.css'
import { stayOnPage, usePageArrival } from '../common/usePageArrival'

import styles from './list.module.css'
import { ReportSummary } from './ReportSummary'

export const unavailableMessage =
  'Reports are unavailable right now. Service checks on the status page are not affected.'

function Active({ reports, now }: { reports: Report[]; now: number }) {
  if (reports.length === 0) {
    return null
  }
  return (
    <section className={styles.group ?? ''} aria-labelledby="reports-active">
      <Heading as="h2" id="reports-active" className={commonStyles.h2 ?? ''}>
        Active
      </Heading>
      <ul className={styles.list ?? ''}>
        {reports.map((report) => (
          <ReportSummary key={report.id} report={report} now={now} level={3} />
        ))}
      </ul>
    </section>
  )
}

function Past({ months, now }: { months: Month<Report>[]; now: number }) {
  if (months.length === 0) {
    return null
  }
  return (
    <section className={styles.group ?? ''} aria-labelledby="reports-past">
      <Heading as="h2" id="reports-past" className={commonStyles.h2 ?? ''}>
        Past
      </Heading>
      {months.map((month) => {
        const id = `reports-month-${String(month.start)}`
        return (
          <section key={month.start} className={styles.month ?? ''} aria-labelledby={id}>
            <Heading as="h3" id={id} className={styles.monthHeading ?? ''}>
              {utcMonth(month.start)}
            </Heading>
            <ul className={styles.list ?? ''}>
              {month.days
                .flatMap((day) => day.entries)
                .map((report) => (
                  <ReportSummary key={report.id} report={report} now={now} level={4} />
                ))}
            </ul>
          </section>
        )
      })}
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

interface ListProps {
  pages: ReportPages
  query: BrowseQuery
  from: number
  now: number
  onChange: (query: BrowseQuery) => void
}

function ListBody({ pages, query, from, now, onChange }: ListProps) {
  if (pages.pending) {
    return (
      <p className={commonStyles.muted ?? ''}>
        <Spinner size="small" srText={null} /> Loading reports…
      </p>
    )
  }
  if (pages.failed && pages.reports.length === 0) {
    return (
      <Banner
        variant="critical"
        title="Reports unavailable"
        hideTitle
        description={unavailableMessage}
        primaryAction={<Banner.PrimaryAction onClick={pages.retry}>Try again</Banner.PrimaryAction>}
      />
    )
  }
  if (pages.reports.length === 0) {
    return <p>No reports have been published.</p>
  }
  return <Loaded pages={pages} query={query} from={from} now={now} onChange={onChange} />
}

/** One line when nothing is listed, with a way back when filters hid everything. */
function EmptyLine({ query, from, onChange }: Omit<ListProps, 'pages' | 'now'>) {
  const filtered = query.state !== 'all' || searchWords(query.search).length > 0
  const since = `since ${utcMonth(from)}`
  if (!filtered) {
    return <p className={styles.empty ?? ''}>No reports {since}.</p>
  }
  return (
    <p className={styles.empty ?? ''}>
      No reports match these filters {since}.{' '}
      <Button
        variant="link"
        onClick={() => {
          onChange({ ...query, state: 'all', search: '' })
        }}
      >
        Clear filters
      </Button>
    </p>
  )
}

function Loaded({ pages, query, from, now, onChange }: ListProps) {
  const view = browseReports(pages.reports, query, from, pages.more)
  const empty = view.active.length === 0 && view.past.length === 0
  return (
    <>
      {pages.failed ? (
        <Banner
          variant="warning"
          title="Not refreshed"
          hideTitle
          description={refreshFailedMessage(
            { lastSuccessAt: pages.updatedAt, failuresInRow: 1 },
            now,
          )}
        />
      ) : null}
      {empty ? <EmptyLine query={query} from={from} onChange={onChange} /> : null}
      <Active reports={view.active} now={now} />
      <Past months={view.past} now={now} />
      <div className={styles.paging ?? ''}>
        {view.older ? (
          <Button
            onClick={() => {
              onChange({ ...query, months: query.months + 1 })
            }}
          >
            Show older reports
          </Button>
        ) : null}
        <span role="status" className={commonStyles.muted ?? ''}>
          {pages.loadingOlder ? (
            <>
              <Spinner size="small" srText={null} /> Loading older reports…
            </>
          ) : null}
        </span>
      </div>
    </>
  )
}

/**
 * /reports (spec 4.4): open reports, then past ones month by month, with a
 * state filter and a title search kept in the URL (?state=, ?search=,
 * ?months=). "Show older reports" adds a month, paging in as needed.
 */
export function ReportsPage() {
  const { header } = usePageConfig()
  const [params, setParams] = useSearchParams()
  const query = readBrowseQuery(params)
  const now = useNow()
  const from = shownFrom(now, query.months)
  const pages = useReportPages({ from, live: true })
  const heading = usePageArrival(`Reports · ${header}`, !pages.pending)
  const change = (next: BrowseQuery) => {
    setParams(writeBrowseQuery(params, next), {
      replace: true,
      preventScrollReset: true,
      state: stayOnPage,
    })
  }
  const filterable = pages.reports.length > 0
  return (
    <>
      <Heading as="h1" ref={heading} tabIndex={-1} className={commonStyles.h1 ?? ''}>
        Reports
      </Heading>
      <div className={styles.layout ?? ''}>
        <div className={styles.rail ?? ''}>
          {filterable ? <NoticeFilters label="Reports" query={query} onChange={change} /> : null}
          <Feeds />
        </div>
        <div className={styles.results ?? ''}>
          <ListBody pages={pages} query={query} from={from} now={now} onChange={change} />
        </div>
      </div>
    </>
  )
}
