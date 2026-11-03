import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { usePageConfig } from '../../config/context'
import { documentTitle } from '../../domain/headline/headline'
import { atParam } from '../../domain/time/at'

import { JustMeResult } from './justme/JustMeResult'
import { useJustMe } from './justme/useJustMe'
import { AnswerPanel } from './panel/AnswerPanel'
import { AtProblem, Warning } from './panel/Banners'
import { TravelBanner } from './panel/TravelBanner'
import { useCopy } from './panel/useCopy'
import { AboutSection } from './sections/AboutSection'
import { RecordSection } from './sections/RecordSection'
import { StorySection } from './sections/StorySection'
import { ServicesSection, ServicesSkeleton } from './services/ServicesSection'
import { useHomeView, type HomeView } from './useHomeView'

/** The status page, now or at ?at= (spec 4.1). */
export function HomePage() {
  const view = useHomeView()
  const { header, browserChecks } = usePageConfig()
  const location = useLocation()
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const copier = useCopy()
  const justMe = useJustMe(browserChecks)
  const { phase, headline: found, travel } = view

  const title =
    phase === 'loading'
      ? `Loading status · ${header}`
      : documentTitle(found, header, travel?.at ?? null)
  useEffect(() => {
    document.title = title
  }, [title])

  // Arriving here, or moving to another moment, moves focus to the H1; the
  // first page load and changes to the search (?q=) do not.
  const moment = new URLSearchParams(location.search).get('at')
  useEffect(() => {
    if (location.key !== 'default') {
      heading.current?.focus()
    }
    // location.key changes on every navigation, including each search keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment])

  const offerJustMe = travel === null && browserChecks.length > 0 && phase === 'ready'
  return (
    <>
      {view.atProblem === null ? null : <AtProblem message={view.atProblem} />}
      {travel === null ? null : <TravelBanner travel={travel} copier={copier} />}
      <AnswerPanel
        view={view}
        headingRef={heading}
        onJustMe={offerJustMe ? justMe.run : null}
        justMeBusy={justMe.state.kind === 'running'}
        onShowMoment={(at) => {
          void navigate(`/?at=${atParam(at)}`)
        }}
        copier={copier}
      />
      {offerJustMe ? (
        <JustMeResult state={justMe.state} checks={browserChecks} services={view.services} />
      ) : null}
      <Body view={view} />
    </>
  )
}

/** The warnings, then story, services and record when there is something to show, then About. */
function Body({ view }: { view: HomeView }) {
  const { phase } = view
  const configured = view.headline.kind !== 'nothing-configured'
  return (
    <>
      {view.refreshFailed === null ? null : (
        <Warning label="Refresh" message={view.refreshFailed} />
      )}
      {view.noticesFailed === null || phase !== 'ready' ? null : (
        <Warning label="Reports and maintenance" message={view.noticesFailed} />
      )}
      {phase === 'loading' ? <ServicesSkeleton /> : null}
      {phase === 'ready' && configured ? (
        <>
          <StorySection items={view.story} reference={view.reference} past={view.travel !== null} />
          <ServicesSection view={view} />
          <RecordSection view={view} />
        </>
      ) : null}
      {phase === 'loading' ? null : <AboutSection view={view} />}
    </>
  )
}
