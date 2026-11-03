import { CheckCircleIcon, XCircleIcon } from '@primer/octicons-react'
import { Banner, Spinner } from '@primer/react'

import { probeTimeoutMs } from '../../../api/browser/probe'
import { StatusWord } from '../../../components/StatusWord/StatusWord'
import type { PageLink } from '../../../config/pageConfig'
import {
  browserCheckNote,
  monitorFor,
  monitorText,
  verdict,
  youText,
  type JustMeRow,
} from '../../../domain/justme/verdict'
import type { ServiceStatus } from '../../../domain/status/service'
import styles from '../home.module.css'

import justMe from './justme.module.css'
import type { JustMeState } from './useJustMe'

export interface JustMeResultProps {
  state: JustMeState
  checks: PageLink[]
  services: ServiceStatus[]
}

/** The browser check result (spec 4.1 item 3, section 8 and 9.4): the verdict, then the table. */
export function JustMeResult({ state, checks, services }: JustMeResultProps) {
  if (state.kind === 'idle') {
    return null
  }
  if (state.kind === 'running') {
    return (
      <p className={`${styles.banner ?? ''} ${justMe.running ?? ''}`} role="status">
        <Spinner size="small" srText={null} /> Checking from your browser…
      </p>
    )
  }
  const rows: JustMeRow[] = checks.flatMap((check, index) => {
    const you = state.outcomes.at(index)
    return you === undefined
      ? []
      : [{ page: check.name, you, monitor: monitorFor(check.name, services) }]
  })
  const found = verdict(rows)
  return (
    <section aria-label="Is it just me?" className={styles.banner ?? ''}>
      <div role="status">
        <Banner aria-label="Browser check result" variant={found.tone}>
          <p className={styles.bannerText ?? ''} data-banner-title="">
            {found.text}
          </p>
        </Banner>
      </div>
      <div className={`${styles.box ?? ''} ${justMe.tableBox ?? ''}`}>
        <table className={justMe.table ?? ''}>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Your browser</th>
              <th scope="col">Our monitor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.page}>
                <th scope="row">{row.page}</th>
                <td data-label="Your browser">
                  <StatusWord
                    tone={row.you.reached ? 'success' : 'danger'}
                    icon={row.you.reached ? CheckCircleIcon : XCircleIcon}
                  >
                    {youText(row.you, probeTimeoutMs)}
                  </StatusWord>
                </td>
                <td data-label="Our monitor">
                  {row.monitor.kind === 'not-monitored' ? (
                    <span className={styles.muted ?? ''}>{monitorText(row.monitor)}</span>
                  ) : (
                    <StatusWord
                      tone={row.monitor.kind === 'passing' ? 'success' : 'danger'}
                      icon={row.monitor.kind === 'passing' ? CheckCircleIcon : XCircleIcon}
                    >
                      {monitorText(row.monitor)}
                    </StatusWord>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={justMe.note ?? ''}>{browserCheckNote}</p>
    </section>
  )
}
