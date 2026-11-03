import { Banner, Button, Label } from '@primer/react'
import type { RefObject } from 'react'
import { Link } from 'react-router'

import { stateIcon } from '../../components/StatusWord/icons'
import { StatusWord } from '../../components/StatusWord/StatusWord'

import styles from './service.module.css'
import type { ServiceReady, ServiceTravel } from './useServiceView'

/** "Breadcrumbs, H1 name" come first; then this: the word, its source, the detail and freshness. */
export function StatePanel({ ready }: { ready: ServiceReady }) {
  const { service } = ready
  const tone = service.tone === 'success' ? {} : { 'data-tone': service.tone }
  return (
    <section className={styles.panel ?? ''} aria-label="Current state" {...tone}>
      <p className={styles.word ?? ''}>
        <StatusWord tone={service.tone} icon={stateIcon(service.state)}>
          {service.word}
        </StatusWord>
        {service.source === null ? null : <Label variant="secondary">{service.source}</Label>}
      </p>
      <p className={styles.detail ?? ''}>{ready.detail}</p>
      {ready.freshness === null ? null : <p className={styles.meta ?? ''}>{ready.freshness}</p>}
    </section>
  )
}

export interface ServiceH1Props {
  headingRef: RefObject<HTMLHeadingElement | null>
  children: string
}

/** The service's name as the page's one H1. */
export function ServiceH1({ headingRef, children }: ServiceH1Props) {
  return (
    <h1 className={styles.h1 ?? ''} tabIndex={-1} ref={headingRef}>
      {children}
    </h1>
  )
}

/** "You are looking at 2 Nov 2026, 13:50 UTC. ..." with the way back to now. */
export function TravelNote({ travel, back }: { travel: ServiceTravel; back: string }) {
  return (
    <Banner aria-label="Time travel" variant="info" className={styles.banner ?? ''}>
      <p className={styles.bannerText ?? ''} data-banner-title="">
        {travel.banner}
      </p>
      <div className={styles.bannerActions ?? ''}>
        <Button as={Link} to={back} size="small" variant="primary">
          Back to now
        </Button>
      </div>
    </Banner>
  )
}

/** A warning in a Primer Banner, written as a paragraph so it adds no heading. */
export function Warning({ label, message }: { label: string; message: string }) {
  return (
    <Banner aria-label={label} variant="warning" className={styles.banner ?? ''}>
      <p className={styles.bannerText ?? ''} data-banner-title="">
        {message}
      </p>
    </Banner>
  )
}
