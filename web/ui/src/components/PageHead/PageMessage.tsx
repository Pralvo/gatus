import { Button } from '@primer/react'
import type { RefObject } from 'react'
import { Link } from 'react-router'

import styles from './PageHead.module.css'

export interface PageMessageProps {
  headingRef: RefObject<HTMLHeadingElement | null>
  title: string
  /** A sentence under the H1, when the H1 alone does not say enough. */
  message?: string
  /** Shows "Try again" for a failed load. */
  onRetry?: () => void
  retrying?: boolean
}

/**
 * A page that has nothing to show: not found, or a load that failed. It says
 * so in words and always offers a way on, so nothing spins forever.
 */
export function PageMessage({ headingRef, title, message, onRetry, retrying }: PageMessageProps) {
  return (
    <section className={styles.panel ?? ''} aria-labelledby="page-message">
      <h1 id="page-message" className={styles.h1 ?? ''} tabIndex={-1} ref={headingRef}>
        {title}
      </h1>
      {message === undefined ? null : <p className={styles.text ?? ''}>{message}</p>}
      <p className={styles.actions ?? ''}>
        {onRetry === undefined ? null : (
          <Button variant="primary" loading={retrying ?? false} onClick={onRetry}>
            Try again
          </Button>
        )}
        <Link to="/">Go to the status page</Link>
      </p>
    </section>
  )
}
