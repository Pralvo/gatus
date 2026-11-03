// Checks for untrusted JSON. Each reader returns undefined for a value of the
// wrong shape, so the clients can drop a bad item instead of passing it on.

export type Raw = Record<string, unknown>

export function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** A non-empty string. */
export function readName(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** An RFC 3339 time with a zone, as Go writes it, as Unix milliseconds. */
export function readTime(value: unknown): number | undefined {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return undefined
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function readOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value)
}

/** Keeps the items the reader accepts; anything but an array gives an empty list. */
export function readList<T>(value: unknown, read: (item: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item: unknown) => {
    const parsed = read(item)
    return parsed === undefined ? [] : [parsed]
  })
}
