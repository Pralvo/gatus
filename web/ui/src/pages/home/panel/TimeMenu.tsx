import { CopyIcon, HistoryIcon, TriangleDownIcon } from '@primer/octicons-react'
import { AnchoredOverlay, Button, FormControl, TextInput } from '@primer/react'
import { useId, useState, type FormEvent } from 'react'

import { atLink, atParam, beforeRecordMessage, parseAt } from '../../../domain/time/at'
import { floorToMinute } from '../../../domain/time/format'
import styles from '../home.module.css'

import type { Copier } from './useCopy'

export interface TimeMenuProps {
  now: number
  /** When monitoring began; null while unknown. */
  recordStart: number | null
  /** Opens the page at a moment. */
  onShow: (at: number) => void
  copier: Copier
}

/** "2026-11-02T13:50": the datetime-local value of a UTC moment. */
function inputValue(ms: number): string {
  return atParam(ms).slice(0, -1)
}

/**
 * The "Now" picker (spec 4.1 and 9.3): a UTC date-time field, "Show this
 * moment" and "Copy link to now". A field cannot live in a menu, so this is an
 * anchored overlay with the same button.
 */
export function TimeMenu({ now, recordStart, onShow, copier }: TimeMenuProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(() => inputValue(now))
  const [problem, setProblem] = useState<string | null>(null)
  const fieldId = useId()
  const { origin } = window.location

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseAt(`${value}Z`, { now, recordStart })
    if (!parsed?.ok) {
      setProblem(parsed?.message ?? 'Choose a time before now, in UTC.')
      return
    }
    setProblem(null)
    setOpen(false)
    onShow(parsed.at)
  }

  return (
    <AnchoredOverlay
      open={open}
      onOpen={() => {
        setValue(inputValue(now))
        setProblem(null)
        setOpen(true)
      }}
      onClose={() => {
        setOpen(false)
      }}
      renderAnchor={(props) => (
        <Button
          {...props}
          size="small"
          variant="invisible"
          leadingVisual={HistoryIcon}
          trailingVisual={TriangleDownIcon}
        >
          Now
        </Button>
      )}
      focusZoneSettings={{ disabled: true }}
      overlayProps={{ role: 'dialog', 'aria-label': 'Look at another moment' }}
    >
      <form className={styles.overlay ?? ''} onSubmit={submit} noValidate>
        <FormControl id={fieldId}>
          <FormControl.Label>Moment (UTC)</FormControl.Label>
          <TextInput
            type="datetime-local"
            value={value}
            {...(recordStart === null ? {} : { min: inputValue(recordStart) })}
            max={inputValue(floorToMinute(now))}
            onChange={(event) => {
              setValue(event.target.value)
            }}
            block
          />
          {recordStart === null ? null : (
            <FormControl.Caption>
              {beforeRecordMessage(recordStart).replace(/, when monitoring began\.$/, '.')}
            </FormControl.Caption>
          )}
          {problem === null ? null : (
            <FormControl.Validation variant="error">{problem}</FormControl.Validation>
          )}
        </FormControl>
        <div className={styles.buttons ?? ''}>
          <Button type="submit" variant="primary" size="small">
            Show this moment
          </Button>
          <Button
            type="button"
            size="small"
            leadingVisual={CopyIcon}
            onClick={() => void copier.copy(atLink(origin, now), 'Link to now')}
          >
            Copy link to now
          </Button>
        </div>
        <p className={styles.status ?? ''} role="status">
          {copier.message}
        </p>
      </form>
    </AnchoredOverlay>
  )
}
