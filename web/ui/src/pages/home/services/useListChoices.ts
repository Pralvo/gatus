import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { usePageConfig } from '../../../config/context'
import type { FilterBy, SortBy } from '../../../config/pageConfig'
import {
  readChoice,
  readCollapsedGroups,
  saveChoice,
  saveCollapsedGroups,
  storageKeys,
} from '../../../prefs/prefs'

export const filterChoices: readonly { value: FilterBy; label: string }[] = [
  { value: 'none', label: 'All services' },
  { value: 'failing', label: 'Failing' },
  { value: 'unstable', label: 'Unstable' },
]

export const sortChoices: readonly { value: SortBy; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'name', label: 'Name' },
  { value: 'health', label: 'Health' },
]

export interface ListChoices {
  query: string
  filterBy: FilterBy
  sortBy: SortBy
  collapsed: string[]
  setQuery: (query: string) => void
  setFilterBy: (filterBy: FilterBy) => void
  setSortBy: (sortBy: SortBy) => void
  toggleGroup: (group: string) => void
  /** "Show all": clears the search and the filter. */
  showAll: () => void
}

/**
 * The visitor's list choices (spec 9.1): the search in ?q=, filter and sort
 * in Gatus's own storage keys, collapsed groups in pralvo:collapsed-groups.
 */
export function useListChoices(): ListChoices {
  const { defaultFilterBy, defaultSortBy } = usePageConfig()
  const [params, setParams] = useSearchParams()
  const [filterBy, setFilter] = useState<FilterBy>(() =>
    readChoice(
      storageKeys.filterBy,
      filterChoices.map((choice) => choice.value),
      defaultFilterBy,
    ),
  )
  const [sortBy, setSort] = useState<SortBy>(() =>
    readChoice(
      storageKeys.sortBy,
      sortChoices.map((choice) => choice.value),
      defaultSortBy,
    ),
  )
  const [collapsed, setCollapsed] = useState<string[]>(() => readCollapsedGroups())
  // The field keeps its own value; the address follows it, so typing never waits on navigation.
  const [query, setQueryValue] = useState(() => params.get('q') ?? '')

  const setQuery = (value: string) => {
    setQueryValue(value)
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value === '') {
          next.delete('q')
        } else {
          next.set('q', value)
        }
        return next
      },
      { replace: true },
    )
  }
  const setFilterBy = (value: FilterBy) => {
    saveChoice(storageKeys.filterBy, value)
    setFilter(value)
  }
  return {
    query,
    filterBy,
    sortBy,
    collapsed,
    setQuery,
    setFilterBy,
    setSortBy: (value) => {
      saveChoice(storageKeys.sortBy, value)
      setSort(value)
    },
    toggleGroup: (group) => {
      const next = collapsed.includes(group)
        ? collapsed.filter((name) => name !== group)
        : [...collapsed, group]
      saveCollapsedGroups(next)
      setCollapsed(next)
    },
    showAll: () => {
      setQuery('')
      setFilterBy('none')
    },
  }
}
