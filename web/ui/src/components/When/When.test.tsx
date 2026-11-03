// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { at } from '../../test/fixtures'

import { When } from './When'

describe('When', () => {
  it('shows UTC with a machine time, relative time on request and local time on hover', () => {
    render(<When ms={at(50)} reference={at(74)} relative />)
    const time = screen.getByText('13:50 UTC · 24 minutes ago')
    expect(time).toHaveAttribute('datetime', '2026-11-02T13:50:00.000Z')
    expect(time.getAttribute('title')).toMatch(/^Your time: /)
  })
})
