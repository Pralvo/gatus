import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

import { useProblemSettings } from './problemApi'

export const problemPath = '/report-a-problem'

export interface ProblemLinkProps {
  /** The service the report is about, from its own page. */
  serviceKey?: string
  /** Shown after the link, such as a separator, only when the link is. */
  suffix?: ReactNode
  /** Puts the link in a paragraph of its own. */
  paragraph?: boolean
}

/** "Report a problem", shown only while the server's form is on. */
export function ProblemLink({ serviceKey, suffix, paragraph = false }: ProblemLinkProps) {
  const settings = useProblemSettings()
  const { pathname } = useLocation()
  if (settings.data == null || pathname === problemPath) {
    return null
  }
  const query = new URLSearchParams({ from: pathname })
  if (serviceKey !== undefined) {
    query.set('service', serviceKey)
  }
  const link = <Link to={`${problemPath}?${query.toString()}`}>Report a problem</Link>
  if (paragraph) {
    return <p>{link}</p>
  }
  return (
    <>
      {link}
      {suffix}
    </>
  )
}
