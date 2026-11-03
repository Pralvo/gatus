import { useCallback, useEffect, useRef, useState } from 'react'

import { probe } from '../../../api/browser/probe'
import type { PageLink } from '../../../config/pageConfig'
import type { ProbeOutcome } from '../../../domain/justme/verdict'

export type JustMeState =
  { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; outcomes: ProbeOutcome[] }

export interface JustMe {
  state: JustMeState
  run: () => void
}

/**
 * Runs the browser checks when asked, never on its own (spec 9.4). The
 * outcomes stay in memory: nothing is stored or sent.
 */
export function useJustMe(checks: PageLink[]): JustMe {
  const [state, setState] = useState<JustMeState>({ kind: 'idle' })
  const running = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      running.current?.abort()
    },
    [],
  )

  const run = useCallback(() => {
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setState({ kind: 'running' })
    void Promise.all(checks.map((check) => probe(check.link, { signal: controller.signal }))).then(
      (outcomes) => {
        if (!controller.signal.aborted) {
          setState({ kind: 'done', outcomes })
        }
      },
    )
  }, [checks])

  return { state, run }
}
