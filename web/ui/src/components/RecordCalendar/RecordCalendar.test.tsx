// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { buildRecord } from '../../domain/record/record'
import { at, event, report } from '../../test/fixtures'

import { RecordCalendar } from './RecordCalendar'

const record = buildRecord({
  services: [
    {
      key: 'media',
      name: 'Media',
      events: [event('START', -60 * 24 * 20), event('UNHEALTHY', 40), event('HEALTHY', 62)],
    },
  ],
  reports: [report({ resolvedAt: at(80), stage: 'resolved' })],
  windows: [],
  end: at(90),
})

function renderCalendar() {
  render(
    <MemoryRouter>
      <RecordCalendar
        record={record}
        toolbar={<span>Filter here</span>}
        links={(day) =>
          day.kind === 'minor' ? [{ label: 'Read the story', to: '/reports/r1' }] : []
        }
      />
    </MemoryRouter>,
  )
  return screen.getByRole('group', { name: 'Daily record, 91 days' })
}

describe('RecordCalendar', () => {
  it('shows 91 days, newest last, each with a full sentence', () => {
    const grid = renderCalendar()
    const days = within(grid).getAllByRole('button')
    expect(days).toHaveLength(91)
    expect(days.at(-1)).toHaveAccessibleName(
      '2 Nov: Media failed checks for 22 minutes (13:40 to 14:02 UTC). Report: “Images were slow to load”.',
    )
    expect(days.at(-2)).toHaveAccessibleName('1 Nov: no failed checks.')
    expect(days[0]).toHaveAccessibleName('4 Aug: no record.')
    expect(days.at(-1)?.dataset.kind).toBe('minor')
    expect(
      screen.getByText(
        '4 Aug to 2 Nov. Each column is 7 days; the newest day is at the bottom right.',
      ),
    ).toBeVisible()
    expect(screen.getByText('No record (before 13 Oct, when monitoring began)')).toBeVisible()
    expect(screen.getByText('Filter here')).toBeVisible()
  })

  it('is one tab stop that moves by day, week, Home and End', async () => {
    const user = userEvent.setup()
    const grid = renderCalendar()
    const days = within(grid).getAllByRole('button')
    await user.tab()
    expect(days[90]).toHaveFocus()
    expect(days.filter((day) => day.tabIndex === 0)).toHaveLength(1)
    await user.keyboard('{ArrowUp}')
    expect(days[89]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(days[82]).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(days[90]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(days[90]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(days[0]).toHaveFocus()
    expect(days[0]?.tabIndex).toBe(0)
    expect(days[90]?.tabIndex).toBe(-1)
    await user.keyboard('{End}')
    expect(days[90]).toHaveFocus()
    await user.tab()
    expect(grid).not.toContainElement(document.activeElement as HTMLElement)
  })

  it('shows a chosen day in a live region, with its links', async () => {
    const user = userEvent.setup()
    const grid = renderCalendar()
    const live = screen.getByText('Choose a day to see what happened.').parentElement
    expect(live).toHaveAttribute('aria-live', 'polite')
    const days = within(grid).getAllByRole('button')
    await user.tab()
    await user.keyboard('{Enter}')
    expect(days[90]).toHaveAttribute('aria-pressed', 'true')
    expect(live).toHaveTextContent('2 Nov: Media failed checks for 22 minutes')
    expect(
      within(live as HTMLElement).getByRole('link', { name: 'Read the story' }),
    ).toHaveAttribute('href', '/reports/r1')
    await user.click(days[89] as HTMLElement)
    expect(live).toHaveTextContent('1 Nov: no failed checks.')
    expect(within(live as HTMLElement).queryByRole('link')).toBeNull()
  })
})
