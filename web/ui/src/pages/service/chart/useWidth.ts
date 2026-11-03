import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * The width of an element, kept current as it resizes, so the chart draws at
 * its real size and its text stays 12 px. `fallback` is used before the first
 * measure and where the browser cannot measure, as in tests.
 */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry?.contentRect.width ?? 0)
      if (measured > 0) {
        setWidth(measured)
      }
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
  return [ref, width]
}
