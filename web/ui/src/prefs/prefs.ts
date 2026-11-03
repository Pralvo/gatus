// The visitor's list choices (spec 9.1). Filter and sort keep Gatus's own
// storage keys, so a visitor's earlier choice carries over. Storage can be
// missing or refuse access, so every read and write falls back quietly.

export const storageKeys = {
  filterBy: 'gatus:filter-by',
  sortBy: 'gatus:sort-by',
  collapsedGroups: 'pralvo:collapsed-groups',
} as const

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    // Storage full or blocked: the choice lasts for this visit only.
  }
}

/** A stored choice, if it is one of the allowed values; otherwise the fallback. */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = read(key)
  return allowed.find((value) => value === stored) ?? fallback
}

export function saveChoice(key: string, value: string): void {
  write(key, value)
}

/** The groups the visitor collapsed; groups are open unless listed. */
export function readCollapsedGroups(): string[] {
  const stored = read(storageKeys.collapsedGroups)
  if (stored === null) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function saveCollapsedGroups(groups: string[]): void {
  write(storageKeys.collapsedGroups, JSON.stringify(groups))
}
