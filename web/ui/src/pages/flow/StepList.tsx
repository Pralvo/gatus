import { Button } from '@primer/react'
import { useRef, useState } from 'react'

import { stateIcon } from '../../components/StatusWord/icons'
import { StatusWord } from '../../components/StatusWord/StatusWord'
import { notRunText, stepWhy, type FlowRun, type FlowStep } from '../../domain/flow/flow'
import { durationText } from '../../domain/time/format'

import styles from './flow.module.css'
import { StepDialog } from './StepDialog'

export interface StepListProps {
  run: FlowRun
  /** How many steps the flow has, as far as the kept runs show. */
  steps: number
}

/** The run's steps in order, each with its result in words, its time and why it failed (spec 4.3). */
export function StepList({ run, steps }: StepListProps) {
  const [open, setOpen] = useState<FlowStep | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const notRun = notRunText(run, steps)
  return (
    <>
      <ol className={styles.steps ?? ''} aria-label="Steps">
        {run.steps.map((step) => {
          const why = stepWhy(step)
          return (
            <li key={step.number} className={styles.step ?? ''}>
              <div className={styles.stepLine ?? ''}>
                <span className={styles.stepName ?? ''}>{step.name}</span>
                <StatusWord
                  tone={step.passed ? 'success' : 'danger'}
                  icon={stateIcon(step.passed ? 'working' : 'failed')}
                >
                  {step.passed ? 'Passed' : 'Failed'}
                </StatusWord>
                <span className={`${styles.muted ?? ''} num`}>{durationText(step.durationMs)}</span>
              </div>
              {why === null ? null : <p className={styles.why ?? ''}>Why: {why}.</p>}
              <Button
                size="small"
                className={styles.details ?? ''}
                aria-label={`Details of step ${String(step.number)}, ${step.name}`}
                onClick={(event) => {
                  opener.current = event.currentTarget
                  setOpen(step)
                }}
              >
                Details
              </Button>
            </li>
          )
        })}
      </ol>
      {notRun === null ? null : <p className={styles.note ?? ''}>{notRun}</p>}
      {run.errors.length === 0 ? null : (
        <p className={styles.note ?? ''}>
          The run itself reported:{' '}
          {run.errors.map((error) => (
            <code key={error} className={styles.code ?? ''}>
              {error}{' '}
            </code>
          ))}
        </p>
      )}
      {open === null ? null : (
        <StepDialog
          step={open}
          returnFocusRef={opener}
          onClose={() => {
            setOpen(null)
          }}
        />
      )}
    </>
  )
}
