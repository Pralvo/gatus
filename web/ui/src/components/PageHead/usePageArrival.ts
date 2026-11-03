import { useEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router'

/**
 * Sets the document title and, after an in-app move to another page, moves
 * focus to the page's H1 once it shows (spec 9.5). Changing only the query,
 * such as choosing a run, keeps focus where it is. The first page load keeps
 * the browser's own focus, so the skip link stays the first stop. Give the
 * returned ref to the H1, with tabIndex={-1}.
 */
export function usePageArrival(
  title: string,
  ready: boolean,
): RefObject<HTMLHeadingElement | null> {
  const heading = useRef<HTMLHeadingElement>(null)
  const { key, pathname } = useLocation()
  const focusedFor = useRef<string | null>(null)
  useEffect(() => {
    document.title = title
  }, [title])
  useEffect(() => {
    if (!ready || focusedFor.current === pathname) {
      return
    }
    focusedFor.current = pathname
    if (key === 'default') {
      // The first page load: the browser keeps its own focus.
      return
    }
    // Focusing the H1 also brings the top of the page into view.
    heading.current?.focus()
  }, [key, pathname, ready])
  return heading
}
