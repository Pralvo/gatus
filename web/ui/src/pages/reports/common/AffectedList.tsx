import { Link } from 'react-router'

import type { ReportEndpoint } from '../../../api/plugins/types'
import { impactWord } from '../../../domain/notices/reports'

import styles from './common.module.css'

export interface AffectedListProps {
  endpoints: ReportEndpoint[]
  /** Link each name to its service page. */
  links?: boolean
}

/** "Media: Degraded", one item per service the report names. */
export function AffectedList({ endpoints, links = false }: AffectedListProps) {
  if (endpoints.length === 0) {
    return <p className={styles.muted ?? ''}>This report names no services.</p>
  }
  return (
    <ul className={styles.affected ?? ''}>
      {endpoints.map((endpoint) => (
        <li key={endpoint.key}>
          {links ? (
            <Link to={`/endpoints/${encodeURIComponent(endpoint.key)}`}>{endpoint.name}</Link>
          ) : (
            endpoint.name
          )}
          : {impactWord(endpoint.impact)}
        </li>
      ))}
    </ul>
  )
}
