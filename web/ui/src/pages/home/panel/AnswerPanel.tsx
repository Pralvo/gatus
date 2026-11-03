import { GlobeIcon, SyncIcon } from '@primer/octicons-react'
import { Button, VisuallyHidden } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { headlineIcon } from '../../../components/StatusWord/icons'
import type { Headline } from '../../../domain/headline/headline'
import styles from '../home.module.css'
import type { HomeView } from '../useHomeView'

import { TimeMenu } from './TimeMenu'
import type { Copier } from './useCopy'

const toneColor: Record<Headline['tone'], string> = {
  success: 'var(--fgColor-success)',
  attention: 'var(--fgColor-attention)',
  severe: 'var(--fgColor-severe)',
  danger: 'var(--fgColor-danger)',
  neutral: 'var(--fgColor-muted)',
}

/** Announces a changed H1 once, politely; never the first one. */
function useAnnouncement(title: string | null): string {
  const previous = useRef(title)
  const [spoken, setSpoken] = useState('')
  useEffect(() => {
    if (title !== null && previous.current !== null && previous.current !== title) {
      setSpoken(title)
    }
    previous.current = title
  }, [title])
  return spoken
}

export interface AnswerPanelProps {
  view: HomeView
  headingRef: RefObject<HTMLHeadingElement | null>
  /** Shows "Is it just me?"; null hides it. */
  onJustMe: (() => void) | null
  justMeBusy: boolean
  onShowMoment: (at: number) => void
  copier: Copier
}

/** The panel while nothing has loaded: a hidden H1 "Loading status" over skeletons. */
function LoadingPanel({ headingRef }: Pick<AnswerPanelProps, 'headingRef'>) {
  return (
    <section className={styles.panel ?? ''} aria-busy="true" aria-labelledby="answer">
      <h1 id="answer" className={styles.h1 ?? ''} tabIndex={-1} ref={headingRef}>
        <VisuallyHidden>Loading status</VisuallyHidden>
        <SkeletonText size="titleLarge" maxWidth="420px" aria-hidden="true" />
      </h1>
      <SkeletonText size="bodyMedium" maxWidth="300px" />
    </section>
  )
}

/** "Is it just me?", freshness, the "Now" picker and "Refresh now". */
function ActionsRow({
  view,
  onJustMe,
  justMeBusy,
  onShowMoment,
  copier,
}: Omit<AnswerPanelProps, 'headingRef'>) {
  const { rank } = view.headline
  return (
    <div className={styles.actions ?? ''}>
      {onJustMe === null ? null : (
        <Button
          variant={rank === 2 || rank === 3 ? 'primary' : 'default'}
          className={styles.primaryAction ?? ''}
          leadingVisual={GlobeIcon}
          loading={justMeBusy}
          onClick={onJustMe}
        >
          Is it just me?
        </Button>
      )}
      <span className={styles.grow ?? ''}>{view.freshness}</span>
      <TimeMenu
        now={view.now}
        recordStart={view.recordStart}
        onShow={onShowMoment}
        copier={copier}
      />
      <Button
        size="small"
        leadingVisual={SyncIcon}
        loading={view.refreshing}
        onClick={() => void view.refreshNow()}
      >
        Refresh now
      </Button>
    </div>
  )
}

/** The answer: icon, H1 and detail line, then the actions row (spec 4.1 and 6). */
export function AnswerPanel(props: AnswerPanelProps) {
  const { view, headingRef } = props
  const { headline: found } = view
  const spoken = useAnnouncement(view.phase === 'ready' ? found.title : null)
  if (view.phase === 'loading') {
    return <LoadingPanel headingRef={headingRef} />
  }
  const Glyph = headlineIcon(found.kind)
  const tone = found.tone === 'success' ? {} : { 'data-tone': found.tone }
  return (
    <section className={styles.panel ?? ''} aria-labelledby="answer" {...tone}>
      <div className={styles.headline ?? ''}>
        <Glyph size={24} aria-hidden="true" fill={toneColor[found.tone]} />
        <div>
          <h1 id="answer" className={styles.h1 ?? ''} tabIndex={-1} ref={headingRef}>
            {found.title}
          </h1>
          {found.detail === null ? null : <p className={styles.detail ?? ''}>{found.detail}</p>}
        </div>
      </div>
      {view.phase === 'error' ? (
        <div className={styles.actions ?? ''}>
          <Button
            variant="primary"
            className={styles.primaryAction ?? ''}
            loading={view.refreshing}
            onClick={() => void view.refreshNow()}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {view.phase === 'ready' && view.travel === null ? (
        <ActionsRow
          view={view}
          onJustMe={props.onJustMe}
          justMeBusy={props.justMeBusy}
          onShowMoment={props.onShowMoment}
          copier={props.copier}
        />
      ) : null}
      <VisuallyHidden aria-live="polite">{spoken}</VisuallyHidden>
    </section>
  )
}
