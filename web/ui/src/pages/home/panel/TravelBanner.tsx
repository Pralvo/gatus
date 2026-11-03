import { CopyIcon } from '@primer/octicons-react'
import { Banner, Button } from '@primer/react'
import { Link } from 'react-router'

import styles from '../home.module.css'
import type { HomeTravel } from '../useHomeView'

import type { Copier } from './useCopy'

export interface TravelBannerProps {
  travel: HomeTravel
  copier: Copier
}

/** "You are looking at 2 Nov 2026, 13:50 UTC. ..." with "Back to now", "Copy link" and "Copy for a ticket". */
export function TravelBanner({ travel, copier }: TravelBannerProps) {
  return (
    <Banner
      aria-label="Time travel"
      variant="info"
      className={`${styles.banner ?? ''} ${styles.bannerFirst ?? ''}`}
    >
      <p className={styles.bannerText ?? ''} data-banner-title="">
        {travel.banner}
      </p>
      {travel.messages.map((message) => (
        <p key={message} className={styles.bannerText ?? ''}>
          {message}
        </p>
      ))}
      <div className={styles.bannerActions ?? ''}>
        <Button
          as={Link}
          to="/"
          size="small"
          variant="primary"
          className={styles.primaryLink ?? ''}
        >
          Back to now
        </Button>
        <Button
          size="small"
          leadingVisual={CopyIcon}
          onClick={() => void copier.copy(travel.link, 'Link')}
        >
          Copy link
        </Button>
        <Button
          size="small"
          leadingVisual={CopyIcon}
          onClick={() => void copier.copy(travel.ticket, 'Ticket text')}
        >
          Copy for a ticket
        </Button>
        <span className={styles.status ?? ''} role="status">
          {copier.message}
        </span>
      </div>
    </Banner>
  )
}
