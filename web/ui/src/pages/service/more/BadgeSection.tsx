import { CopyIcon } from '@primer/octicons-react'
import { Button } from '@primer/react'

import { badgeLinks } from '../../../domain/badges/badges'
import { useCopy } from '../../home/panel/useCopy'

import styles from './more.module.css'

/** "Embed a badge": each badge's address, absolute, with a copy button (spec 4.2 item 9). */
export function BadgeSection({ serviceKey, name }: { serviceKey: string; name: string }) {
  const copier = useCopy()
  const badges = badgeLinks(window.location.origin, serviceKey)
  return (
    <section className={styles.section ?? ''} aria-label="Badges">
      <details className={styles.embed ?? ''}>
        <summary>Embed a badge</summary>
        <p className={styles.sub ?? ''}>
          Badges are images other pages can show. Each one is current when it loads.
        </p>
        {badges.map((badge) => (
          <div key={badge.label} className={styles.badge ?? ''}>
            <p className={styles.badgeLabel ?? ''}>{badge.label}</p>
            <div className={styles.code ?? ''}>
              <code>{badge.url}</code>
              <Button
                size="small"
                leadingVisual={CopyIcon}
                aria-label={`Copy the ${badge.label.toLowerCase()} badge address for ${name}`}
                onClick={() => void copier.copy(badge.url, 'Badge address')}
              >
                Copy
              </Button>
            </div>
          </div>
        ))}
        <p className={styles.status ?? ''} role="status">
          {copier.message}
        </p>
      </details>
    </section>
  )
}
