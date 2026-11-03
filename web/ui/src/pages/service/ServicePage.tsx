import { VisuallyHidden } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'

import { Crumbs } from '../../components/PageHead/Crumbs'
import { PageMessage } from '../../components/PageHead/PageMessage'
import { usePageArrival } from '../../components/PageHead/usePageArrival'
import { usePageConfig } from '../../config/context'
import { utcClock, utcDay } from '../../domain/time/format'

import { ResponseSection } from './chart/ResponseSection'
import { RecentChecks } from './checks/RecentChecks'
import { BadgeSection } from './more/BadgeSection'
import { HistorySection } from './more/HistorySection'
import { RecordPart } from './more/RecordPart'
import { NormalSection, WorkingSection } from './NormalSection'
import styles from './service.module.css'
import { ServiceH1, StatePanel, TravelNote, Warning } from './StatePanel'
import { useServiceView, type ServiceView } from './useServiceView'

export const missingServiceTitle = 'There is no service at this address'

/** "Media · Pralvo status", or "Media · 2 Nov 13:50 UTC · Pralvo status" in time travel. */
function titleOf(view: ServiceView, siteName: string): string {
  switch (view.phase) {
    case 'loading':
      return `Loading service · ${siteName}`
    case 'missing':
      return `Not found · ${siteName}`
    case 'error':
      return `Status unavailable · ${siteName}`
    default: {
      const name = view.ready?.service.name ?? view.key
      const moment =
        view.travel === null ? '' : ` · ${utcDay(view.travel.at)} ${utcClock(view.travel.at)}`
      return `${name}${moment} · ${siteName}`
    }
  }
}

/** The page while the statuses load: a hidden H1 "Loading service" over skeletons. */
function Loading({ headingRef }: { headingRef: ReturnType<typeof usePageArrival> }) {
  return (
    <div aria-busy="true">
      <h1 className={styles.h1 ?? ''} tabIndex={-1} ref={headingRef}>
        <VisuallyHidden>Loading service</VisuallyHidden>
        <SkeletonText size="titleMedium" maxWidth="240px" aria-hidden="true" />
      </h1>
      <div className={styles.panel ?? ''}>
        <SkeletonText size="titleMedium" maxWidth="160px" />
        <SkeletonText lines={2} />
      </div>
    </div>
  )
}

/** One service: its state, how it compares with normal, its checks, record, history and badges (spec 4.2). */
export function ServicePage() {
  const view = useServiceView()
  const { header } = usePageConfig()
  const headingRef = usePageArrival(titleOf(view, header), view.phase !== 'loading')
  if (view.phase === 'loading') {
    return <Loading headingRef={headingRef} />
  }
  if (view.phase === 'missing') {
    return <PageMessage headingRef={headingRef} title={missingServiceTitle} />
  }
  if (view.phase === 'error' || view.ready === null) {
    return (
      <PageMessage
        headingRef={headingRef}
        title="Status unavailable"
        message="This page could not load the service status. Try again in a minute."
        onRetry={() => void view.refreshNow()}
        retrying={view.refreshing}
      />
    )
  }
  const { ready } = view
  const { service } = ready
  const past = view.travel !== null
  const back = `/endpoints/${encodeURIComponent(view.key)}`
  return (
    <>
      <Crumbs group={service.group} name={service.name} />
      <ServiceH1 headingRef={headingRef}>{service.name}</ServiceH1>
      {view.atProblem === null ? null : <Warning label="Time travel" message={view.atProblem} />}
      {view.travel === null ? null : <TravelNote travel={view.travel} back={back} />}
      <StatePanel ready={ready} />
      {view.refreshFailed === null ? null : (
        <Warning label="Refresh" message={view.refreshFailed} />
      )}
      {view.noticesFailed === null ? null : (
        <Warning label="Reports and maintenance" message={view.noticesFailed} />
      )}
      <NormalSection ready={ready} past={past} />
      <WorkingSection ready={ready} />
      {service.normal.kind === 'not-measured' ? null : (
        <ResponseSection
          serviceKey={view.key}
          events={ready.input.events}
          reference={view.reference}
          past={past}
        />
      )}
      <RecentChecks
        serviceKey={view.key}
        name={service.name}
        results={ready.results}
        reference={view.reference}
        past={past}
        stale={ready.stale}
      />
      <RecordPart view={view} />
      <HistorySection
        events={ready.input.events}
        loading={view.eventsLoading}
        reference={view.reference}
      />
      {past ? null : <BadgeSection serviceKey={view.key} name={service.name} />}
    </>
  )
}
