import { Button, Label, Spinner } from '@primer/react'
import { Link, useSearchParams } from 'react-router'

import { NoticeFilters } from '../../../components/NoticeFilters/NoticeFilters'
import { When } from '../../../components/When/When'
import { useReportPages } from '../../../data/service'
import { isFiltered, isResolved, matchesNotice } from '../../../domain/browse/filter'
import { groupByMonth, shownFrom, utcMonth } from '../../../domain/browse/months'
import { mergeReports, olderMayExist } from '../../../domain/browse/pages'
import { readBrowseQuery, writeBrowseQuery, type BrowseQuery } from '../../../domain/browse/query'
import { noticeItems, noticeLabel, type NoticeItem } from '../../../domain/notices/past'
import { utcClockNear, utcDay } from '../../../domain/time/format'
import home from '../home.module.css'
import type { HomeView } from '../useHomeView'

function Notice({ item, reference }: { item: NoticeItem; reference: number }) {
  const stage = item.kind === 'report' ? item.stage : null
  return (
    <p className={home.notice ?? ''}>
      <Label variant={stage === 'resolved' ? 'success' : 'secondary'}>{noticeLabel(item)}</Label>
      <span className={home.muted ?? ''}>
        <When ms={item.at} reference={reference} />
      </span>
      {item.kind === 'report' ? (
        <Link className="pralvo-quiet" to={`/reports/${encodeURIComponent(item.id)}`}>
          {item.title}
        </Link>
      ) : (
        <span>
          {item.title}
          {item.state === 'in-progress' ? `, until ${utcClockNear(item.end, reference)}` : ''}
        </span>
      )}
    </p>
  )
}

/** The one line shown when no notice is listed. */
function emptyLine(query: BrowseQuery, from: number): string {
  const since = `since ${utcMonth(from)}`
  return isFiltered(query) ? `No notices match these filters ${since}.` : `No notices ${since}.`
}

/**
 * "Past notices": reports and maintenance month by month, newest first, only
 * on days that have some. Kind, state, search and how many months are in the
 * URL, so a view can be shared. Unresolved notices are listed whatever their
 * age; "Show older notices" adds a month, paging in older reports as needed.
 */
export function PastNotices({ view }: { view: HomeView }) {
  const [params, setParams] = useSearchParams()
  const query = readBrowseQuery(params)
  const from = shownFrom(view.reference, query.months)
  const unavailable = view.noticesFailed !== null
  const older = useReportPages({
    from,
    first: { reports: view.reports, page: 1, more: view.reportsMore },
    live: false,
    enabled: !unavailable,
  })
  const matching = noticeItems({
    reports: mergeReports(view.reports, older.reports),
    windows: view.windows,
    end: view.reference,
  }).filter((item) => matchesNotice(item, query))
  const shown = matching.filter((item) => item.at >= from || !isResolved(item))
  const months = groupByMonth(shown, (item) => item.at)
  const change = (next: BrowseQuery) => {
    setParams(writeBrowseQuery(params, next), { replace: true, preventScrollReset: true })
  }
  let body = <p className={home.muted ?? ''}>Not available right now.</p>
  if (!unavailable) {
    body =
      months.length === 0 ? (
        <p className={home.muted ?? ''}>{emptyLine(query, from)}</p>
      ) : (
        <>
          {months.map((month) => (
            <div key={month.start}>
              <h3 className={home.h3 ?? ''}>{utcMonth(month.start)}</h3>
              <ol className={`${home.box ?? ''} ${home.days ?? ''}`}>
                {month.days.map((day) => (
                  <li key={day.start}>
                    <p className={home.dayLabel ?? ''}>
                      <time dateTime={new Date(day.start).toISOString().slice(0, 10)}>
                        {utcDay(day.start)}
                      </time>
                    </p>
                    {day.entries.map((item) => (
                      <Notice
                        key={`${item.kind}-${item.kind === 'report' ? item.id : item.title}-${String(item.at)}`}
                        item={item}
                        reference={view.reference}
                      />
                    ))}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>
      )
  }
  const offerOlder =
    !unavailable &&
    olderMayExist(
      matching.map((item) => item.at),
      from,
      older.more,
    )
  return (
    <section id="notices" className={home.part ?? ''} aria-labelledby="notices-heading">
      <h2 id="notices-heading" className={home.h2 ?? ''}>
        Past notices
      </h2>
      <p className={home.sub ?? ''}>
        Reports and maintenance since {utcMonth(from)}, newest first.
      </p>
      <NoticeFilters label="Past notices" query={query} onChange={change} kinds />
      {body}
      <div className={home.more ?? ''}>
        {offerOlder ? (
          <Button
            onClick={() => {
              change({ ...query, months: query.months + 1 })
            }}
          >
            Show older notices
          </Button>
        ) : null}
        <Link to="/reports">All reports</Link>
        <span role="status" className={home.muted ?? ''}>
          {older.loadingOlder ? (
            <>
              <Spinner size="small" srText={null} /> Loading older reports…
            </>
          ) : null}
          {older.failed ? 'Older reports could not be loaded.' : null}
        </span>
      </div>
    </section>
  )
}
