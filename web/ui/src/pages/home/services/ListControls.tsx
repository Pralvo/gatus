import { SearchIcon } from '@primer/octicons-react'
import { FormControl, Select, TextInput } from '@primer/react'

import type { FilterBy, SortBy } from '../../../config/pageConfig'

import styles from './services.module.css'
import { filterChoices, sortChoices, type ListChoices } from './useListChoices'

/** Search, filter and sort, shown only above 8 services (spec section 5). */
export function ListControls({ choices }: { choices: ListChoices }) {
  return (
    <div className={styles.controls ?? ''}>
      <FormControl>
        <FormControl.Label>Search</FormControl.Label>
        <TextInput
          type="search"
          leadingVisual={SearchIcon}
          value={choices.query}
          onChange={(event) => {
            choices.setQuery(event.target.value)
          }}
          block
        />
      </FormControl>
      <FormControl>
        <FormControl.Label>Filter</FormControl.Label>
        <Select
          value={choices.filterBy}
          onChange={(event) => {
            const found = filterChoices.find((choice) => choice.value === event.target.value)
            choices.setFilterBy(found?.value ?? ('none' satisfies FilterBy))
          }}
        >
          {filterChoices.map((choice) => (
            <Select.Option key={choice.value} value={choice.value}>
              {choice.label}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
      <FormControl>
        <FormControl.Label>Sort by</FormControl.Label>
        <Select
          value={choices.sortBy}
          onChange={(event) => {
            const found = sortChoices.find((choice) => choice.value === event.target.value)
            choices.setSortBy(found?.value ?? ('group' satisfies SortBy))
          }}
        >
          {sortChoices.map((choice) => (
            <Select.Option key={choice.value} value={choice.value}>
              {choice.label}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
    </div>
  )
}
