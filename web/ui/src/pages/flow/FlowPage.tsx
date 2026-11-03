import { Banner, VisuallyHidden } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'
import type { UseQueryResult } from '@tanstack/react-query'
import type { RefObject } from 'react'
import { useParams, useSearchParams } from 'react-router'

import type { SuiteStatus } from '../../api/types'
import { Crumbs } from '../../components/PageHead/Crumbs'
import head from '../../components/PageHead/PageHead.module.css'
import { PageMessage } from '../../components/PageHead/PageMessage'
import { Section } from '../../components/PageHead/Section'
import { usePageArrival } from '../../components/PageHead/usePageArrival'
import { stateIcon } from '../../components/StatusWord/icons'
import { StatusWord } from '../../components/StatusWord/StatusWord'
import { When } from '../../components/When/When'
import { usePageConfig } from '../../config/context'
import { useNow } from '../../data/cycle'
import { isNotFound, useFlow } from '../../data/service'
import {
  chooseRun,
  flowRuns,
  missingRunMessage,
  runSentence,
  stepCount,
  type FlowRun,
} from '../../domain/flow/flow'

import styles from './flow.module.css'
import { RunList } from './RunList'
import { StepList } from './StepList'

export const missingFlowTitle = 'There is no flow at this address'

/** The latest run in words: "Failed. Step 3 of 4, Sign in, failed after 0.8 s." */
function LatestRun({ latest, steps, now }: { latest: FlowRun | null; steps: number; now: number }) {
  if (latest === null) {
    return (
      <section className={head.panel ?? ''} aria-label="Latest run">
        <p className={styles.word ?? ''}>
          <StatusWord tone="neutral" icon={stateIcon('no-checks')}>
            No runs yet
          </StatusWord>
        </p>
        <p className={head.text ?? ''}>This flow has not run yet.</p>
      </section>
    )
  }
  return (
    <section className={head.panel ?? ''} aria-label="Latest run">
      <p className={styles.word ?? ''}>
        <StatusWord
          tone={latest.passed ? 'success' : 'danger'}
          icon={stateIcon(latest.passed ? 'working' : 'failed')}
        >
          {latest.passed ? 'Latest run passed' : 'Latest run failed'}
        </StatusWord>
      </p>
      <p className={head.text ?? ''}>{runSentence(latest, steps)}</p>
      <p className={styles.note ?? ''}>
        Ran at <When ms={latest.at} reference={now} relative />.
      </p>
    </section>
  )
}

interface LoadedFlowProps {
  status: SuiteStatus
  name: string
  now: number
  headingRef: RefObject<HTMLHeadingElement | null>
}

/** The flow once loaded: crumbs, H1, the latest run, the chosen run's steps and the runs. */
function LoadedFlow({ status, name, now, headingRef }: LoadedFlowProps) {
  const [params, setParams] = useSearchParams()
  const runs = flowRuns(status)
  const steps = stepCount(runs)
  const { run, missing } = chooseRun(runs, params.get('run'))
  return (
    <>
      <Crumbs group={status.group ?? ''} name={name} />
      <h1 className={`${head.h1 ?? ''} ${styles.h1 ?? ''}`} tabIndex={-1} ref={headingRef}>
        {name}
      </h1>
      <LatestRun latest={runs.at(0) ?? null} steps={steps} now={now} />
      {missing ? (
        <Banner aria-label="Run" variant="warning" className={styles.banner ?? ''}>
          <p className={styles.text ?? ''} data-banner-title="">
            {missingRunMessage}
          </p>
        </Banner>
      ) : null}
      {run === null ? null : (
        <>
          <Section id="steps-heading" title="Steps">
            <p className={styles.lead ?? ''}>
              The run at <When ms={run.at} reference={now} />, in order. {runSentence(run, steps)}
            </p>
            <StepList run={run} steps={steps} />
          </Section>
          <Section id="runs-heading" title="Recent runs">
            <RunList
              runs={runs}
              chosen={run}
              reference={now}
              onChoose={(chosen) => {
                setParams((current) => {
                  const next = new URLSearchParams(current)
                  next.set('run', chosen.id)
                  return next
                })
              }}
            />
          </Section>
        </>
      )}
    </>
  )
}

function titleOf(flow: UseQueryResult<SuiteStatus>, name: string, siteName: string): string {
  if (flow.data !== undefined) {
    return `${name} · ${siteName}`
  }
  if (flow.isError) {
    return isNotFound(flow.error) ? `Not found · ${siteName}` : `Flow unavailable · ${siteName}`
  }
  return `Loading flow · ${siteName}`
}

/** One flow, a Gatus suite: its latest run, the chosen run's steps and the recent runs (spec 4.3). */
export function FlowPage() {
  const key = useParams().key ?? ''
  const { header } = usePageConfig()
  const now = useNow()
  const flow = useFlow(key)
  const name = flow.data?.name ?? key
  const headingRef = usePageArrival(titleOf(flow, name, header), !flow.isPending)
  if (flow.data !== undefined) {
    return <LoadedFlow status={flow.data} name={name} now={now} headingRef={headingRef} />
  }
  if (!flow.isError) {
    return (
      <div aria-busy="true">
        <h1 className={head.h1 ?? ''} tabIndex={-1} ref={headingRef}>
          <VisuallyHidden>Loading flow</VisuallyHidden>
          <SkeletonText size="titleMedium" maxWidth="240px" aria-hidden="true" />
        </h1>
        <div className={head.panel ?? ''}>
          <SkeletonText lines={2} />
        </div>
      </div>
    )
  }
  return isNotFound(flow.error) ? (
    <PageMessage headingRef={headingRef} title={missingFlowTitle} />
  ) : (
    <PageMessage
      headingRef={headingRef}
      title="Flow unavailable"
      message="This page could not load the flow. Try again in a minute."
      onRetry={() => void flow.refetch()}
      retrying={flow.isFetching}
    />
  )
}
