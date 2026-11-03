import { createContext, useContext } from 'react'

import { defaultPageConfig, type PageConfig } from './pageConfig'

export const PageConfigContext = createContext<PageConfig>(defaultPageConfig)

export function usePageConfig(): PageConfig {
  return useContext(PageConfigContext)
}
