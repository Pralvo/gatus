// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readChoice,
  readCollapsedGroups,
  saveChoice,
  saveCollapsedGroups,
  storageKeys,
} from './prefs'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('list choices', () => {
  it("reads Gatus's own keys", () => {
    window.localStorage.setItem('gatus:sort-by', 'health')
    expect(readChoice(storageKeys.sortBy, ['name', 'group', 'health'], 'group')).toBe('health')
    saveChoice(storageKeys.filterBy, 'failing')
    expect(window.localStorage.getItem('gatus:filter-by')).toBe('failing')
  })

  it('ignores values it does not know', () => {
    window.localStorage.setItem('gatus:sort-by', 'random')
    expect(readChoice(storageKeys.sortBy, ['name', 'group'], 'group')).toBe('group')
  })

  it('falls back when storage refuses access', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(readChoice(storageKeys.sortBy, ['name', 'group'], 'group')).toBe('group')
    expect(() => {
      saveChoice(storageKeys.sortBy, 'name')
    }).not.toThrow()
    expect(readCollapsedGroups()).toEqual([])
  })
})

describe('collapsed groups', () => {
  it('stores names as a list and drops anything else', () => {
    saveCollapsedGroups(['Public site'])
    expect(readCollapsedGroups()).toEqual(['Public site'])
    window.localStorage.setItem(storageKeys.collapsedGroups, '[1,"Media","x"]')
    expect(readCollapsedGroups()).toEqual(['Media', 'x'])
    window.localStorage.setItem(storageKeys.collapsedGroups, 'not json')
    expect(readCollapsedGroups()).toEqual([])
  })
})
