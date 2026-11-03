import { ActionList } from '@primer/react'

import { stateIcon } from '../../components/StatusWord/icons'
import { runLabel, type FlowRun } from '../../domain/flow/flow'

import styles from './flow.module.css'

export interface RunListProps {
  runs: FlowRun[]
  chosen: FlowRun
  reference: number
  onChoose: (run: FlowRun) => void
}

/** The kept runs, newest first, as a single-select list; choosing one sets ?run= (spec 4.3). */
export function RunList({ runs, chosen, reference, onChoose }: RunListProps) {
  return (
    <div className={styles.box ?? ''}>
      <ActionList selectionVariant="single" role="listbox" aria-label="Recent runs">
        {runs.map((run) => {
          const Glyph = stateIcon(run.passed ? 'working' : 'failed')
          return (
            <ActionList.Item
              key={run.id}
              role="option"
              selected={run.id === chosen.id}
              onSelect={() => {
                onChoose(run)
              }}
            >
              <ActionList.LeadingVisual>
                <Glyph className={(run.passed ? styles.passed : styles.failed) ?? ''} />
              </ActionList.LeadingVisual>
              {runLabel(run, reference)}
            </ActionList.Item>
          )
        })}
      </ActionList>
    </div>
  )
}
