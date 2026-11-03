import { VisuallyHidden } from '@primer/react'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'

import type { Result } from '../../api/types'
import {
  slotSentence,
  stripEnds,
  stripLabel,
  stripSlotCount,
  stripSlots,
  stripSummary,
  type SlotKind,
} from '../../domain/checks/strip'

import styles from './CheckStrip.module.css'
import { SlotPopover } from './SlotPopover'

const slotClasses = new Map<SlotKind, string | undefined>([
  ['passed', styles.passed],
  ['failed', styles.failed],
  ['none', styles.none],
])

/** The slot an event happened on, from its data-index. */
function slotIndex(target: EventTarget): number | null {
  const index = target instanceof HTMLElement ? target.dataset.index : undefined
  return index === undefined ? null : Number(index)
}

export interface CheckStripProps {
  /** The service's name, for the strip's accessible name. */
  name: string
  /** Kept results, in any order. */
  results: Result[]
  /** Now, or the time-travel moment. */
  reference: number
  /** In time travel the right end reads "at 13:50 UTC", not "now". */
  past?: boolean
  /** Half opacity when the page may be out of date. */
  dimmed?: boolean
  slotCount?: number
}

/**
 * One slot per check, newest on the right, failed checks taller. The strip is
 * one tab stop: arrows, Home and End move between checks, Enter pins the
 * popover and Escape closes it. Hover shows a check; a click pins it.
 */
export function CheckStrip({
  name,
  results,
  reference,
  past = false,
  dimmed = false,
  slotCount = stripSlotCount,
}: CheckStripProps) {
  const slots = useMemo(() => stripSlots(results, slotCount), [results, slotCount])
  const last = slots.length - 1
  const [current, setCurrent] = useState<number | null>(null)
  const [cursor, setCursor] = useState(last)
  const [pinned, setPinned] = useState(false)
  const [focused, setFocused] = useState(false)
  const [spoken, setSpoken] = useState('')
  const summaryId = useId()
  const ends = stripEnds(slots, reference, past)
  const shown = current === null ? null : slots.at(current)

  const moveTo = (index: number) => {
    const next = Math.min(Math.max(index, 0), last)
    setCursor(next)
    setCurrent(next)
    const slot = slots.at(next)
    setSpoken(slot === undefined ? '' : slotSentence(slot, reference))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: cursor - 1,
      ArrowRight: cursor + 1,
      Home: 0,
      End: last,
    }
    const target = moves[event.key]
    if (target !== undefined) {
      event.preventDefault()
      moveTo(target)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      setCurrent(cursor)
      setPinned(true)
    } else if (event.key === 'Escape' && current !== null) {
      event.preventDefault()
      setCurrent(null)
      setPinned(false)
    }
  }

  return (
    <div className={styles.wrap ?? ''}>
      <div
        role="group"
        tabIndex={0}
        aria-label={stripLabel(name, slots)}
        aria-describedby={summaryId}
        className={`${styles.strip ?? ''} ${dimmed ? (styles.dimmed ?? '') : ''}`}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true)
          setCurrent(cursor)
        }}
        onBlur={() => {
          setFocused(false)
          setPinned(false)
          setCurrent(null)
        }}
        onMouseOver={(event) => {
          const index = slotIndex(event.target)
          if (index !== null && !pinned) {
            setCurrent(index)
          }
        }}
        onClick={(event) => {
          const index = slotIndex(event.target)
          if (index !== null) {
            setCursor(index)
            setCurrent(index)
            setPinned(true)
          }
        }}
        onMouseLeave={() => {
          if (!pinned && !focused) {
            setCurrent(null)
          }
        }}
      >
        {slots.map((slot, index) => (
          <span
            // Slots never move or reorder while a strip is shown.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            role="img"
            aria-label={slotSentence(slot, reference)}
            data-kind={slot.kind}
            data-index={index}
            className={`${styles.slot ?? ''} ${slotClasses.get(slot.kind) ?? ''} ${
              index === current ? (styles.current ?? '') : ''
            }`}
          />
        ))}
      </div>
      {ends === null ? null : (
        <div className={styles.ends ?? ''} aria-hidden="true">
          <span>{ends.first}</span>
          <span>{ends.last}</span>
        </div>
      )}
      {shown === undefined || shown === null || current === null ? null : (
        <SlotPopover slot={shown} position={(current + 0.5) / slots.length} reference={reference} />
      )}
      <VisuallyHidden id={summaryId}>{stripSummary(slots, reference)}</VisuallyHidden>
      <VisuallyHidden aria-live="polite">{spoken}</VisuallyHidden>
    </div>
  )
}
