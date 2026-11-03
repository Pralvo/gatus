// @vitest-environment jsdom
import { CheckCircleIcon } from '@primer/octicons-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { headlineIcon, stateIcon } from './icons'
import { StatusWord } from './StatusWord'

describe('StatusWord', () => {
  it('shows the word with a hidden icon and its tone', () => {
    render(
      <StatusWord tone="success" icon={CheckCircleIcon}>
        Working
      </StatusWord>,
    )
    const word = screen.getByText('Working').parentElement
    expect(word).toHaveAttribute('data-tone', 'success')
    expect(word?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('has an icon for every state and headline', () => {
    expect(stateIcon('failed')).not.toBe(stateIcon('working'))
    expect(headlineIcon('stale')).toBe(stateIcon('late'))
  })
})
