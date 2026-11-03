import { BaseStyles } from '@primer/react'
import { ThemeProvider } from '@primer/react/next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'

import { PageConfigContext } from '../config/context'
import type { PageConfig } from '../config/pageConfig'
import { FlowPage } from '../pages/flow/FlowPage'
import { HomePage } from '../pages/home/HomePage'
import { NotFound } from '../pages/NotFound'
import { ReportsPage } from '../pages/reports/list/ReportsPage'
import { ReportPage } from '../pages/reports/report/ReportPage'
import { ServicePage } from '../pages/service/ServicePage'

import { Layout } from './Layout'
import { colorModeOf, readThemeChoice, saveThemeChoice, type ThemeChoice } from './theme'

export interface AppProps {
  config: PageConfig
  queryClient?: QueryClient
}

/** The public app: theme, data cache and routes. */
export function App({ config, queryClient }: AppProps) {
  const [client] = useState(() => queryClient ?? new QueryClient())
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice())
  const choose = (choice: ThemeChoice) => {
    saveThemeChoice(choice)
    setTheme(choice)
  }
  return (
    <PageConfigContext value={config}>
      <QueryClientProvider client={client}>
        <ThemeProvider colorMode={colorModeOf(theme)} dayScheme="light" nightScheme="dark">
          <BaseStyles className="pralvo-root">
            <BrowserRouter>
              <Routes>
                <Route element={<Layout theme={theme} onTheme={choose} />}>
                  <Route index element={<HomePage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="reports/:id" element={<ReportPage />} />
                  <Route path="endpoints/:key" element={<ServicePage />} />
                  <Route path="suites/:key" element={<FlowPage />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </BaseStyles>
        </ThemeProvider>
      </QueryClientProvider>
    </PageConfigContext>
  )
}
