import { CheckCircleIcon, XCircleIcon } from '@primer/octicons-react'

import { emptySlotText, slotDetails, type Slot } from '../../domain/checks/strip'
import { StatusWord } from '../StatusWord/StatusWord'

import styles from './CheckStrip.module.css'

export interface SlotPopoverProps {
  slot: Slot
  /** Where the slot sits along the strip, 0 to 1, to place the popover near it. */
  position: number
  reference: number
}

/**
 * The facts of one check: time, result, response and why. Screen readers hear
 * the same facts from the strip's live region, so this copy is hidden from them.
 */
export function SlotPopover({ slot, position, reference }: SlotPopoverProps) {
  const details = slotDetails(slot, reference)
  return (
    <div
      className={styles.popover ?? ''}
      style={{ ['--slot-at' as string]: `${String(position * 100)}%` }}
      aria-hidden="true"
      data-testid="slot-popover"
    >
      {details === null ? (
        <p>{emptySlotText}</p>
      ) : (
        <dl>
          <dt>Time</dt>
          <dd className="num">{details.time}</dd>
          <dt>Result</dt>
          <dd>
            <StatusWord
              tone={details.why === null ? 'success' : 'danger'}
              icon={details.why === null ? CheckCircleIcon : XCircleIcon}
            >
              {details.result}
            </StatusWord>
          </dd>
          <dt>Response</dt>
          <dd className="num">{details.response}</dd>
          {details.why === null ? null : (
            <>
              <dt>Why</dt>
              <dd>{details.why}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
