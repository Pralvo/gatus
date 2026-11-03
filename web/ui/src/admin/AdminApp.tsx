// The admin app: the same theme and tint as the public pages, its own data
// cache and session, and routes under /admin.

import { BaseStyles } from '@primer/react'
import { ThemeProvider } from '@primer/react/next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'

import { colorModeOf, readThemeChoice, saveThemeChoice, type ThemeChoice } from '../app/theme'

import { IncidentDetail } from './incidents/detail/IncidentDetail'
import { IncidentsPage } from './incidents/IncidentsPage'
import { ReportEditor } from './reports/editor/ReportEditor'
import { ReportsPage } from './reports/ReportsPage'
import { SessionProvider } from './session/Session'
import { AdminFrame } from './shell/AdminFrame'
import { AdminHeading, FocusArmed, useArmFocus, useDocumentTitle } from './shell/page'

export interface AdminAppProps {
  queryClient?: QueryClient
}

function NotFound() {
  useDocumentTitle('Not found')
  return (
    <>
      <AdminHeading>There is nothing at this address</AdminHeading>
      <p>
        <Link to="/">Go to the reports</Link>
      </p>
    </>
  )
}

export function AdminApp({ queryClient }: AdminAppProps) {
  const [client] = useState(() => queryClient ?? new QueryClient())
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice())
  const armed = useArmFocus()
  const choose = (choice: ThemeChoice) => {
    saveThemeChoice(choice)
    setTheme(choice)
  }
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider colorMode={colorModeOf(theme)} dayScheme="light" nightScheme="dark">
        <BaseStyles className="pralvo-root">
          <BrowserRouter basename="/admin">
            <FocusArmed value={armed}>
              <SessionProvider>
                <Routes>
                  <Route element={<AdminFrame theme={theme} onTheme={choose} />}>
                    <Route index element={<ReportsPage />} />
                    <Route path="reports/:id" element={<ReportEditor />} />
                    <Route path="incidents" element={<IncidentsPage />} />
                    <Route path="incidents/:id" element={<IncidentDetail />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </SessionProvider>
            </FocusArmed>
          </BrowserRouter>
        </BaseStyles>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
