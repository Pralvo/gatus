// The outcome of the last action ("Update posted.", or what went wrong), shown
// above the page in a polite live region. A notice belongs to one address and
// disappears when the reader moves to another.

import { Banner } from '@primer/react'
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'

export type NoticeTone = 'success' | 'critical'

interface Notice {
  text: string
  tone: NoticeTone
  path: string
}

/** Shows a notice on the current page, or on `path` when the action is about to go there. */
export type Say = (text: string, tone?: NoticeTone, path?: string) => void

interface NoticeState {
  notice: Notice | null
  say: Say
}

const NoticeContext = createContext<NoticeState>({ notice: null, say: () => undefined })

export function NoticeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [notice, setNotice] = useState<Notice | null>(null)
  const say = useCallback<Say>(
    (text, tone = 'success', path = pathname) => {
      setNotice({ text, tone, path })
    },
    [pathname],
  )
  const state = useMemo(() => ({ notice, say }), [notice, say])
  return <NoticeContext value={state}>{children}</NoticeContext>
}

export function useSay(): Say {
  return use(NoticeContext).say
}

export function NoticeArea() {
  const { notice } = use(NoticeContext)
  const { pathname } = useLocation()
  const shown = notice !== null && notice.path === pathname ? notice : null
  return (
    <div role="status" aria-live="polite">
      {shown === null ? null : (
        <Banner
          title={shown.tone === 'critical' ? 'That did not work' : 'Done'}
          hideTitle
          description={shown.text}
          variant={shown.tone}
        />
      )}
    </div>
  )
}
