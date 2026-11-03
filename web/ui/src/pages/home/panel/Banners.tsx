import { Banner, Button } from '@primer/react'
import { Link } from 'react-router'

import styles from '../home.module.css'

export interface WarningProps {
  /** The banner region's name. */
  label: string
  message: string
}

/**
 * A warning in a Primer Banner. The message is the banner's title, written
 * as a paragraph so it adds no heading before or between the page's own.
 */
export function Warning({ label, message }: WarningProps) {
  return (
    <Banner aria-label={label} variant="warning" className={styles.banner ?? ''}>
      <p className={styles.bannerText ?? ''} data-banner-title="">
        {message}
      </p>
    </Banner>
  )
}

/** An unusable ?at= (spec section 8): the message, and the way back to now. */
export function AtProblem({ message }: { message: string }) {
  return (
    <Banner
      aria-label="Time travel"
      variant="warning"
      className={`${styles.banner ?? ''} ${styles.bannerFirst ?? ''}`}
    >
      <p className={styles.bannerText ?? ''} data-banner-title="">
        {message}
      </p>
      <div className={styles.bannerActions ?? ''}>
        <Button as={Link} to="/" size="small" className={styles.defaultLink ?? ''}>
          Back to now
        </Button>
      </div>
    </Banner>
  )
}
