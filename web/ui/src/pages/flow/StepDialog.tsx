import { Dialog } from '@primer/react'
import type { RefObject } from 'react'

import { stateIcon } from '../../components/StatusWord/icons'
import { StatusWord } from '../../components/StatusWord/StatusWord'
import { conditionReason } from '../../domain/conditions/why'
import { stepWhy, type FlowStep } from '../../domain/flow/flow'
import { durationText } from '../../domain/time/format'

import styles from './flow.module.css'

export interface StepDialogProps {
  step: FlowStep
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

/** One step's details: its result, time, each condition and any error, as text (spec 4.3). */
export function StepDialog({ step, onClose, returnFocusRef }: StepDialogProps) {
  const why = stepWhy(step)
  return (
    <Dialog
      title={`Step ${String(step.number)}: ${step.name}`}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      width="large"
      // The page keeps its one H1, so the dialog's title is an H2.
      renderHeader={({ dialogLabelId, title, onClose: close }) => (
        <Dialog.Header>
          <div className={styles.dialogHead ?? ''}>
            <h2 id={dialogLabelId} className={styles.dialogTitle ?? ''}>
              {title}
            </h2>
            <Dialog.CloseButton
              onClose={() => {
                close('close-button')
              }}
            />
          </div>
        </Dialog.Header>
      )}
    >
      <p className={styles.text ?? ''}>
        <StatusWord
          tone={step.passed ? 'success' : 'danger'}
          icon={stateIcon(step.passed ? 'working' : 'failed')}
        >
          {step.passed ? 'Passed' : 'Failed'}
        </StatusWord>{' '}
        in {durationText(step.durationMs)}.
      </p>
      {why === null ? null : <p className={styles.text ?? ''}>Why: {why}.</p>}
      {step.conditions.length === 0 ? null : (
        <>
          <h3 className={styles.h3 ?? ''}>Conditions</h3>
          <ul className={styles.conditions ?? ''}>
            {step.conditions.map((condition, index) => (
              // Conditions may repeat; their order is the check's own.
              // eslint-disable-next-line react/no-array-index-key
              <li key={index}>
                <StatusWord
                  tone={condition.success ? 'success' : 'danger'}
                  icon={stateIcon(condition.success ? 'working' : 'failed')}
                >
                  {condition.success ? 'Met' : 'Not met'}
                </StatusWord>{' '}
                <code className={styles.code ?? ''}>{condition.condition}</code>
                {condition.success ? null : (
                  <span className={styles.muted ?? ''}>
                    {' '}
                    ({conditionReason(condition.condition).text})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {step.errors.length === 0 ? null : (
        <>
          <h3 className={styles.h3 ?? ''}>Errors</h3>
          <ul className={styles.conditions ?? ''}>
            {step.errors.map((error) => (
              <li key={error}>
                <code className={styles.code ?? ''}>{error}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  )
}
