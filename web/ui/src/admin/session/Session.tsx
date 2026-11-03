// The signed-in session: the token, the API client built on it, and signing in
// and out. A 401 from any call signs out with "That token was not accepted.",
// and signing out forgets the token and every admin record held in memory.

import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

import { failureMessages, makeSend, type SendOptions } from '../api/client'
import { incidentCalls } from '../api/incidents'
import { reportCalls } from '../api/reports'

import { forgetToken, readToken, saveToken } from './token'

export function createAdminClient(options: SendOptions) {
  const send = makeSend(options)
  return { ...reportCalls(send), ...incidentCalls(send) }
}

export type AdminClient = ReturnType<typeof createAdminClient>

export interface Session {
  /** Null while signed out. */
  client: AdminClient | null
  /** Why the last session ended, for the sign-in screen. */
  endedBecause: Ending | null
  /** Checks the token with one read and keeps it; throws an AdminError when refused. */
  signIn: (token: string) => Promise<void>
  signOut: (reason: string, critical?: boolean) => void
}

/** "Signed out.", or a refusal such as "That token was not accepted.", which is critical. */
export interface Ending {
  text: string
  critical: boolean
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(() => readToken())
  const [endedBecause, setEndedBecause] = useState<Ending | null>(null)

  const signOut = useCallback(
    (reason: string, critical = false) => {
      forgetToken()
      setToken(null)
      setEndedBecause({ text: reason, critical })
      queryClient.clear()
    },
    [queryClient],
  )

  const signIn = useCallback(async (candidate: string) => {
    await createAdminClient({ token: candidate }).listReports({ limit: 1 })
    saveToken(candidate)
    setEndedBecause(null)
    setToken(candidate)
  }, [])

  const client = useMemo(
    () =>
      token === null
        ? null
        : createAdminClient({
            token,
            onUnauthorized: () => {
              signOut(failureMessages.unauthorized, true)
            },
          }),
    [token, signOut],
  )

  const session = useMemo(
    () => ({ client, endedBecause, signIn, signOut }),
    [client, endedBecause, signIn, signOut],
  )
  return <SessionContext value={session}>{children}</SessionContext>
}

export function useSession(): Session {
  const session = use(SessionContext)
  if (session === null) {
    throw new Error('useSession needs a SessionProvider')
  }
  return session
}

/** The client of a signed-in page. Pages render only while signed in. */
export function useAdminClient(): AdminClient {
  const { client } = useSession()
  if (client === null) {
    throw new Error('useAdminClient needs a signed-in session')
  }
  return client
}
