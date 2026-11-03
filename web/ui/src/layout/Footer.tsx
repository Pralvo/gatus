import { MarkGithubIcon } from '@primer/octicons-react'
import { Fragment } from 'react'

import { usePageConfig } from '../config/context'

import styles from './layout.module.css'

const separator = (
  <span aria-hidden="true" className={styles.separator ?? ''}>
    ·
  </span>
)

/** "Pralvo · Source (Apache 2.0) · Powered by Gatus", the source icon and the feeds. */
export function Footer() {
  const { footerLinks, sourceLink, feeds } = usePageConfig()
  return (
    <footer className={styles.footer ?? ''}>
      <div className={`pralvo-wrap ${styles.footerColumn ?? ''}`}>
        <p className={styles.footerLine ?? ''}>
          {footerLinks.map((item) => (
            <Fragment key={item.link + item.name}>
              <a href={item.link} rel="noopener">
                {item.name}
              </a>
              {separator}
            </Fragment>
          ))}
          Powered by{' '}
          <a href="https://gatus.io" rel="noopener">
            Gatus
          </a>
        </p>
        <a
          className={styles.sourceIcon ?? ''}
          href={sourceLink}
          rel="noopener"
          aria-label="Source code on GitHub"
        >
          <MarkGithubIcon size={20} />
        </a>
        {feeds ? (
          <p className={styles.footerLine ?? ''}>
            Subscribe: <a href="/feed/atom.xml">Atom</a>
            {separator}
            <a href="/feed/rss.xml">RSS</a>
            {separator}
            <a href="/feed/feed.json">JSON Feed</a>
          </p>
        ) : null}
      </div>
    </footer>
  )
}
