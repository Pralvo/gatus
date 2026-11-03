// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { colorModeOf, readThemeChoice, saveThemeChoice } from './theme'

afterEach(() => {
  saveThemeChoice('system')
})

describe('theme choice', () => {
  it('reads light and dark, and treats anything else as system', () => {
    expect(readThemeChoice('a=1; theme=dark')).toBe('dark')
    expect(readThemeChoice('theme=light')).toBe('light')
    expect(readThemeChoice('theme=purple')).toBe('system')
    expect(readThemeChoice('')).toBe('system')
  })

  it('saves a choice in the cookie and forgets it for system', () => {
    saveThemeChoice('dark')
    expect(readThemeChoice()).toBe('dark')
    saveThemeChoice('system')
    expect(readThemeChoice()).toBe('system')
  })

  it('maps choices to Primer colour modes', () => {
    expect(colorModeOf('system')).toBe('auto')
    expect(colorModeOf('dark')).toBe('dark')
  })
})
