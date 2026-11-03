// Pieces every admin page uses: its H1, which takes focus when the page
// changes, the document title, and times in UTC with local time on hover.

import { Heading } from '@primer/react'
import { createContext, use, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useLocation } from 'react-router'

import { localTime, relativeTime, utcClockNear } from '../../domain/time/format'

import styles from './shell.module.css'

/** True once the first screen has rendered; a heading then takes focus when it appears. */
export const FocusArmed = createContext<RefObject<boolean>>({ current: false })

/** Arms heading focus after the first render, so the first load does not move focus. */
export function useArmFocus(): RefObject<boolean> {
  const armed = useRef(false)
  useEffect(() => {
    armed.current = true
  }, [])
  return armed
}

export function AdminHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  const armed = use(FocusArmed)
  const { key } = useLocation()
  useEffect(() => {
    if (armed.current) {
      ref.current?.focus()
    }
  }, [armed, key])
  return (
    <Heading as="h1" variant="medium" ref={ref} tabIndex={-1} className={styles.h1 ?? ''}>
      {children}
    </Heading>
  )
}

/** "Reports · Admin · Pralvo status" */
export function useDocumentTitle(lead: string): void {
  useEffect(() => {
    document.title = `${lead} · Admin · Pralvo status`
  }, [lead])
}

/** "3 Nov, 14:03 UTC (2 hours ago)", with the reader's local time on hover. */
export function When({ at, now }: { at: number; now: number }) {
  return (
    <>
      <time className="num" dateTime={new Date(at).toISOString()} title={localTime(at)}>
        {utcClockNear(at, now)}
      </time>{' '}
      <span className={styles.muted ?? ''}>({relativeTime(at, now)})</span>
    </>
  )
}
