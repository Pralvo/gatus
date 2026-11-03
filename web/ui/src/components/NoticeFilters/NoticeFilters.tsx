import { SearchIcon } from '@primer/octicons-react'
import { FormControl, SegmentedControl, Select, TextInput } from '@primer/react'
import { useId } from 'react'

import type { NoticeKind, NoticeState } from '../../domain/browse/filter'
import { maxSearchLength, type BrowseQuery } from '../../domain/browse/query'

import styles from './NoticeFilters.module.css'

const kindOptions: { value: NoticeKind; word: string }[] = [
  { value: 'all', word: 'All' },
  { value: 'reports', word: 'Reports' },
  { value: 'maintenance', word: 'Maintenance' },
]

const stateOptions: { value: NoticeState; word: string }[] = [
  { value: 'all', word: 'Any state' },
  { value: 'unresolved', word: 'Unresolved' },
  { value: 'resolved', word: 'Resolved' },
]

export interface NoticeFiltersProps {
  /** Names the search landmark, such as "Past notices". */
  label: string
  query: BrowseQuery
  onChange: (query: BrowseQuery) => void
  /** Offer the kind switch; the reports list has one kind only. */
  kinds?: boolean
}

/** Kind, state and title search for a list of notices or reports. The caller keeps them in the URL. */
export function NoticeFilters({ label, query, onChange, kinds = false }: NoticeFiltersProps) {
  const kindLabel = useId()
  return (
    <form
      role="search"
      aria-label={label}
      className={styles.filters ?? ''}
      onSubmit={(event) => {
        // Every change applies at once; Enter in the search box has nothing to send.
        event.preventDefault()
      }}
    >
      {kinds ? (
        <div className={styles.kind ?? ''}>
          <span id={kindLabel} className={styles.label ?? ''}>
            Show
          </span>
          <SegmentedControl
            aria-labelledby={kindLabel}
            fullWidth
            size="small"
            onChange={(index) => {
              onChange({ ...query, kind: kindOptions.at(index)?.value ?? 'all' })
            }}
          >
            {kindOptions.map((option) => (
              <SegmentedControl.Button key={option.value} selected={query.kind === option.value}>
                {option.word}
              </SegmentedControl.Button>
            ))}
          </SegmentedControl>
        </div>
      ) : null}
      <FormControl>
        <FormControl.Label>State</FormControl.Label>
        <Select
          block
          value={query.state}
          onChange={(event) => {
            const chosen = stateOptions.find((option) => option.value === event.target.value)
            onChange({ ...query, state: chosen?.value ?? 'all' })
          }}
        >
          {stateOptions.map((option) => (
            <Select.Option key={option.value} value={option.value}>
              {option.word}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
      <FormControl className={styles.search ?? ''}>
        <FormControl.Label>Search titles</FormControl.Label>
        <TextInput
          block
          type="search"
          leadingVisual={SearchIcon}
          maxLength={maxSearchLength}
          value={query.search}
          onChange={(event) => {
            onChange({ ...query, search: event.target.value })
          }}
        />
      </FormControl>
    </form>
  )
}
