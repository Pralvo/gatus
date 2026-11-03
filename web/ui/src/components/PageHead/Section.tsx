import type { ReactNode } from 'react'

import styles from './PageHead.module.css'

export interface SectionProps {
  /** The H2's id, which names the section. */
  id: string
  title: string
  /** Controls beside the H2, such as a period switch. */
  aside?: ReactNode
  children: ReactNode
}

/** One part of a page: an H2 and its content, 40 px below the part before (spec 10). */
export function Section({ id, title, aside, children }: SectionProps) {
  return (
    <section className={styles.section ?? ''} aria-labelledby={id}>
      <div className={styles.sectionHead ?? ''}>
        <h2 id={id} className={styles.h2 ?? ''}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
