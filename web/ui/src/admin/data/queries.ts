// React Query hooks for the admin records, and one way to run an action:
// call the API, keep the cache current, and say what happened. A refused token
// needs no message here, because the session has already signed out.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { AdminError, failureMessages } from '../api/client'
import type { AdminIncident, AdminReport } from '../api/types'
import { useAdminClient, type AdminClient } from '../session/Session'
import { useSay } from '../shell/notice'

export const adminKeys = {
  all: ['admin'] as const,
  reports: ['admin', 'reports'] as const,
  report: (id: string) => ['admin', 'report', id] as const,
  incidents: ['admin', 'incidents'] as const,
  incident: (id: string) => ['admin', 'incident', id] as const,
}

const once = { retry: false, refetchOnWindowFocus: false } as const

export function useAdminReports() {
  const client = useAdminClient()
  return useQuery({ queryKey: adminKeys.reports, queryFn: () => client.listReports(), ...once })
}

export function useAdminReport(id: string) {
  const client = useAdminClient()
  return useQuery({ queryKey: adminKeys.report(id), queryFn: () => client.getReport(id), ...once })
}

export function useAdminIncidents() {
  const client = useAdminClient()
  return useQuery({ queryKey: adminKeys.incidents, queryFn: () => client.listIncidents(), ...once })
}

export function useAdminIncident(id: string) {
  const client = useAdminClient()
  return useQuery({
    queryKey: adminKeys.incident(id),
    queryFn: () => client.getIncident(id),
    ...once,
  })
}

/** Keeps a changed report in the cache and marks the list as out of date. */
export function storeReport(queryClient: QueryClient, report: AdminReport): void {
  queryClient.setQueryData(adminKeys.report(report.id), report)
  void queryClient.invalidateQueries({ queryKey: adminKeys.reports })
}

export function storeIncident(queryClient: QueryClient, incident: AdminIncident): void {
  queryClient.setQueryData(adminKeys.incident(incident.id), incident)
  void queryClient.invalidateQueries({ queryKey: adminKeys.incidents })
}

/** The words for any failure. */
export function failureText(error: unknown): string {
  return error instanceof AdminError ? error.message : failureMessages.unreachable
}

export interface ActionOutcome {
  /** "Update posted." */
  message: string
  /** Where the message belongs when the action moves the reader; the current page by default. */
  path?: string
}

export interface ActionOptions {
  /** False when the caller shows failures itself, as a dialog does. */
  sayFailures?: boolean
}

/** One action of a page. `after` stores the result and words the outcome. */
export function useAdminAction<Input, Result>(
  run: (client: AdminClient, input: Input) => Promise<Result>,
  after: (result: Result, queryClient: QueryClient, input: Input) => ActionOutcome,
  { sayFailures = true }: ActionOptions = {},
) {
  const client = useAdminClient()
  const queryClient = useQueryClient()
  const say = useSay()
  return useMutation({
    mutationFn: (input: Input) => run(client, input),
    retry: false,
    onSuccess: (result, input) => {
      const outcome = after(result, queryClient, input)
      say(outcome.message, 'success', outcome.path)
    },
    onError: (error) => {
      if (!sayFailures || (error instanceof AdminError && error.kind === 'unauthorized')) {
        return
      }
      say(failureText(error), 'critical')
    },
  })
}
