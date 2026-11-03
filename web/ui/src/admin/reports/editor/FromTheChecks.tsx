// "From the checks": services whose latest check failed and that the report
// does not name yet, each with a button that marks it as a partial outage.

import { Banner, Button } from '@primer/react'

import type { Suggestion } from '../../../domain/admin/preview'
import styles from '../reports.module.css'

export interface FromTheChecksProps {
  suggestions: readonly Suggestion[]
  onAdd: (suggestion: Suggestion) => void
}

export function FromTheChecks({ suggestions, onAdd }: FromTheChecksProps) {
  if (suggestions.length === 0) {
    return null
  }
  return (
    <Banner
      title="From the checks"
      variant="warning"
      description={
        <ul className={styles.suggestions ?? ''}>
          {suggestions.map((suggestion) => (
            <li key={suggestion.key}>
              <span>{suggestion.sentence}</span>{' '}
              <Button
                size="small"
                onClick={() => {
                  onAdd(suggestion)
                }}
              >
                Add {suggestion.name} as affected
              </Button>
            </li>
          ))}
        </ul>
      }
    />
  )
}
