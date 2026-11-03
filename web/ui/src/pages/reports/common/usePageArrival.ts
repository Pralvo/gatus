import { useEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router'

/**
 * Sets the document title and, after an in-app navigation, moves focus to the
 * page's H1 once it shows its real content (spec 9.5). The first page load
 * keeps the browser's own focus, so the skip link stays the first stop.
 * Give the returned ref to the H1, with tabIndex={-1}.
 */
export function usePageArrival(
  title: string,
  ready: boolean,
): RefObject<HTMLHeadingElement | null> {
  const heading = useRef<HTMLHeadingElement>(null)
  const { key } = useLocation()
  const focusedFor = useRef<string | null>(null)
  useEffect(() => {
    document.title = title
  }, [title])
  useEffect(() => {
    if (!ready || key === 'default' || focusedFor.current === key) {
      return
    }
    focusedFor.current = key
    heading.current?.focus()
  }, [key, ready])
  return heading
}
