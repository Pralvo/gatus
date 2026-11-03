import { useEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router'

/** Navigation state for a change within a page, such as a filter: focus stays where it is. */
export const stayOnPage = { stay: true } as const

function stays(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'stay' in state && state.stay === true
}

/**
 * Sets the document title and, after an in-app navigation, moves focus to the
 * page's H1 once it shows its real content (spec 9.5). The first page load
 * keeps the browser's own focus, so the skip link stays the first stop, and so
 * does a change made with `stayOnPage` state, such as typing in a filter.
 * Give the returned ref to the H1, with tabIndex={-1}.
 */
export function usePageArrival(
  title: string,
  ready: boolean,
): RefObject<HTMLHeadingElement | null> {
  const heading = useRef<HTMLHeadingElement>(null)
  const { key, state } = useLocation()
  const stay = stays(state)
  const focusedFor = useRef<string | null>(null)
  useEffect(() => {
    document.title = title
  }, [title])
  useEffect(() => {
    if (!ready || key === 'default' || focusedFor.current === key) {
      return
    }
    focusedFor.current = key
    if (!stay) {
      heading.current?.focus()
    }
  }, [key, ready, stay])
  return heading
}
