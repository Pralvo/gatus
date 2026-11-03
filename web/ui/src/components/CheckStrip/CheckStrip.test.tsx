// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { at, results } from '../../test/fixtures'

import { CheckStrip } from './CheckStrip'

const now = at(61)

function renderStrip(failing: number[] = [50]) {
  render(
    <>
      <button type="button">Before</button>
      <CheckStrip
        name="Media"
        results={results(4, { last: 60, failing })}
        reference={now}
        slotCount={6}
      />
      <button type="button">After</button>
    </>,
  )
  return screen.getByRole('group', { name: /checks of Media/ })
}

function popover(): HTMLElement | null {
  return screen.queryByTestId('slot-popover')
}

describe('CheckStrip', () => {
  it('is one tab stop with a full-sentence name for every slot', async () => {
    const user = userEvent.setup()
    const strip = renderStrip()
    expect(strip).toHaveAccessibleName(
      'Last 4 checks of Media. Use the arrow keys to read each check.',
    )
    expect(strip).toHaveAccessibleDescription(
      '4 checks since 13:45 UTC: 3 passed, 1 failed, the last at 13:50 UTC.',
    )
    const slots = screen.getAllByRole('img')
    expect(slots.map((slot) => slot.getAttribute('aria-label'))).toEqual([
      'No check in this slot yet.',
      'No check in this slot yet.',
      '13:45 UTC: passed in 70 ms.',
      '13:50 UTC: failed: answered with error 503; it needs a code below 500.',
      '13:55 UTC: passed in 70 ms.',
      '14:00 UTC: passed in 70 ms.',
    ])
    expect(slots.map((slot) => slot.dataset.kind)).toEqual([
      'none',
      'none',
      'passed',
      'failed',
      'passed',
      'passed',
    ])
    await user.tab()
    await user.tab()
    expect(strip).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('shows the newest check on focus and moves with arrows, Home and End', async () => {
    const user = userEvent.setup()
    const strip = renderStrip()
    act(() => {
      strip.focus()
    })
    expect(popover()).toHaveTextContent('Time14:00 UTCResultPassedResponse70 ms')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(popover()).toHaveTextContent(
      'Time13:50 UTCResultFailedResponse70 msWhyanswered with error 503; it needs a code below 500',
    )
    expect(screen.getByText(/^13:50 UTC: failed/, { selector: '[aria-live]' })).toBeVisible()
    await user.keyboard('{Home}')
    expect(popover()).toHaveTextContent('No check in this slot yet.')
    await user.keyboard('{ArrowLeft}')
    expect(popover()).toHaveTextContent('No check in this slot yet.')
    await user.keyboard('{End}')
    expect(popover()).toHaveTextContent('14:00 UTC')
    await user.keyboard('{ArrowRight}')
    expect(popover()).toHaveTextContent('14:00 UTC')
  })

  it('closes the popover with Escape and pins it with Enter', async () => {
    const user = userEvent.setup()
    const strip = renderStrip()
    act(() => {
      strip.focus()
    })
    await user.keyboard('{Escape}')
    expect(popover()).toBeNull()
    await user.keyboard('{Enter}')
    expect(popover()).not.toBeNull()
    fireEvent.mouseOver(screen.getAllByRole('img')[2] as HTMLElement)
    expect(popover()).toHaveTextContent('14:00 UTC')
  })

  it('shows a check on hover and hides it when the pointer leaves', () => {
    const strip = renderStrip()
    fireEvent.mouseOver(screen.getAllByRole('img')[3] as HTMLElement)
    expect(popover()).toHaveTextContent('13:50 UTC')
    fireEvent.mouseLeave(strip)
    expect(popover()).toBeNull()
  })

  it('keeps a clicked check until focus leaves', async () => {
    const user = userEvent.setup()
    const strip = renderStrip()
    await user.click(screen.getAllByRole('img')[3] as HTMLElement)
    fireEvent.mouseLeave(strip)
    expect(popover()).toHaveTextContent('13:50 UTC')
    await user.click(screen.getByRole('button', { name: 'After' }))
    expect(popover()).toBeNull()
  })

  it('dims when the page may be out of date and says when nothing is kept', () => {
    render(<CheckStrip name="Blog" results={[]} reference={now} dimmed slotCount={3} />)
    const strip = screen.getByRole('group', { name: 'Checks of Blog: none kept yet.' })
    expect(strip.className).toContain('dimmed')
    expect(strip).toHaveAccessibleDescription('No checks yet.')
  })
})
