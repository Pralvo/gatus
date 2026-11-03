import { Label } from '@primer/react'
import { Link } from 'react-router'

import type { Result } from '../../../api/types'
import { CheckStrip } from '../../../components/CheckStrip/CheckStrip'
import { stateIcon } from '../../../components/StatusWord/icons'
import { StatusWord } from '../../../components/StatusWord/StatusWord'
import { rowLine } from '../../../domain/services/row'
import type { ServiceStatus } from '../../../domain/status/service'
import { atParam } from '../../../domain/time/at'

import styles from './services.module.css'

export interface ServiceRowProps {
  service: ServiceStatus
  results: Result[]
  reference: number
  stale: boolean
  /** The time-travel moment, or null now. */
  travelAt: number | null
}

/** Name, status word and source; then the trend, why or comparison; then the strip. */
export function ServiceRow({ service, results, reference, stale, travelAt }: ServiceRowProps) {
  const travel = travelAt !== null
  const to = `/endpoints/${encodeURIComponent(service.key)}${
    travel ? `?at=${atParam(travelAt)}` : ''
  }`
  return (
    <li className={styles.row ?? ''}>
      <div className={styles.line1 ?? ''}>
        <Link className={`${styles.name ?? ''} pralvo-quiet`} to={to}>
          {service.name}
        </Link>
        <StatusWord tone={service.tone} icon={stateIcon(service.state)}>
          {service.word}
        </StatusWord>
        {service.showSource && service.source !== null ? (
          <Label variant="secondary">{service.source}</Label>
        ) : null}
      </div>
      <p className={styles.line2 ?? ''}>
        {rowLine(service, {
          reference,
          stale,
          ...(travel ? { kept: results.length > 0 } : {}),
        })}
      </p>
      <CheckStrip
        name={service.name}
        results={results}
        reference={reference}
        past={travel}
        dimmed={stale}
      />
    </li>
  )
}
