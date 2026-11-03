import { Banner, Breadcrumbs, Heading, Spinner } from '@primer/react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'

import type { Report } from '../../../api/plugins/types'
import { usePageConfig } from '../../../config/context'
import { useNow } from '../../../data/cycle'
import { isNotFound, useReport, useServiceEvents } from '../../../data/service'
import { refreshFailedMessage } from '../../../domain/freshness/refresh'
import { ribbon } from '../../../domain/ribbon/ribbon'
import {
  affectedServices,
  reportStory,
  ribbonText,
  stageSentence,
} from '../../../domain/story/report'
import { reportTicketText } from '../../../domain/travel/ticket'
import { AffectedList } from '../common/AffectedList'
import commonStyles from '../common/common.module.css'
import { usePageArrival } from '../common/usePageArrival'

import styles from './report.module.css'
import { RibbonFigure, type FailuresKnown } from './ribbon/RibbonFigure'
import { StagePanel } from './StagePanel'
import { StoryTimeline } from './StoryTimeline'

export const notFoundMessage = 'This report does not exist.'
export const loadFailedMessage =
  'This report could not be loaded. Service checks on the status page are not affected.'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={commonStyles.section ?? ''} aria-labelledby={id}>
      <Heading as="h2" id={id} className={commonStyles.h2 ?? ''}>
        {title}
      </Heading>
      {children}
    </section>
  )
}

function AllReports() {
  return (
    <p className={commonStyles.section ?? ''}>
      <Link to="/reports">All reports</Link>
    </p>
  )
}

interface LoadedProps {
  report: Report
  now: number
  stale: string | null
}

/** The report once loaded: stage panel, ribbon, services and story. */
function LoadedReport({ report, now, stale }: LoadedProps) {
  const { header } = usePageConfig()
  const keys = report.endpoints.map((endpoint) => endpoint.key)
  const events = useServiceEvents(keys)
  const known = keys.every((key) => events.byKey.has(key))
  let failures: FailuresKnown = 'known'
  if (!known) {
    failures = events.loading ? 'loading' : 'failed'
  }
  const story = reportStory(report, affectedServices(report, events.byKey), now)
  const sentence = stageSentence(report, known ? story.failedMinutes : null)
  const { origin } = window.location
  const ticket = () =>
    reportTicketText({
      report,
      sentence,
      now: Date.now(),
      link: `${origin}/reports/${encodeURIComponent(report.id)}`,
      siteName: header,
    })
  return (
    <>
      {stale === null ? null : (
        <Banner variant="warning" title="Not refreshed" hideTitle description={stale} />
      )}
      <StagePanel report={report} sentence={sentence} ticket={ticket} origin={origin} />
      <Section id="report-glance" title="At a glance">
        <div className={commonStyles.box ?? ''}>
          <RibbonFigure
            picture={ribbon(report, story, now)}
            lines={ribbonText(report, story, now)}
            failures={failures}
          />
        </div>
      </Section>
      <Section id="report-affected" title="Affected services">
        <div className={commonStyles.box ?? ''}>
          <AffectedList endpoints={report.endpoints} links />
        </div>
      </Section>
      <Section id="report-story" title="The story">
        <p className={styles.lede ?? ''}>
          Checks and report updates, oldest first. Times in UTC.
          {failures === 'failed'
            ? ' Check events could not be loaded, so only the report updates are shown.'
            : ''}
        </p>
        <div className={commonStyles.box ?? ''}>
          <StoryTimeline items={story.items} reference={report.resolvedAt ?? now} />
        </div>
      </Section>
    </>
  )
}

/** /reports/:id (spec 4.5). A draft and an unknown id look the same: not found. */
export function ReportPage() {
  const { header } = usePageConfig()
  const { id = '' } = useParams()
  const query = useReport(id)
  const now = useNow()
  const missing = query.isError && isNotFound(query.error)
  const report = missing ? undefined : query.data
  let title = `Reports · ${header}`
  if (missing) {
    title = `Not found · Reports · ${header}`
  } else if (report !== undefined) {
    title = `${report.title} · Reports · ${header}`
  }
  const heading = usePageArrival(title, !query.isPending)
  // Breadcrumbs end with the report's title, so they wait for it.
  const crumbs =
    report === undefined ? null : (
      <Breadcrumbs className={styles.crumbs ?? ''}>
        <Breadcrumbs.Item as={Link} to="/">
          Status
        </Breadcrumbs.Item>
        <Breadcrumbs.Item as={Link} to="/reports">
          Reports
        </Breadcrumbs.Item>
        <Breadcrumbs.Item as="span" selected>
          {report.title}
        </Breadcrumbs.Item>
      </Breadcrumbs>
    )
  let h1 = 'Report'
  let body
  if (query.isPending) {
    body = (
      <p className={commonStyles.muted ?? ''}>
        <Spinner size="small" srText={null} /> Loading the report…
      </p>
    )
  } else if (missing) {
    h1 = notFoundMessage
    body = <AllReports />
  } else if (report === undefined) {
    body = (
      <>
        <Banner
          variant="critical"
          title="Report unavailable"
          hideTitle
          description={loadFailedMessage}
          primaryAction={
            <Banner.PrimaryAction onClick={() => void query.refetch()}>
              Try again
            </Banner.PrimaryAction>
          }
        />
        <AllReports />
      </>
    )
  } else {
    h1 = report.title
    const stale = query.isError
      ? refreshFailedMessage({ lastSuccessAt: query.dataUpdatedAt, failuresInRow: 1 }, now)
      : null
    body = (
      <>
        <LoadedReport report={report} now={now} stale={stale} />
        <AllReports />
      </>
    )
  }
  return (
    <>
      {crumbs}
      <Heading
        as="h1"
        ref={heading}
        tabIndex={-1}
        className={`${commonStyles.h1 ?? ''} ${commonStyles.text ?? ''}`}
      >
        {h1}
      </Heading>
      {body}
    </>
  )
}
