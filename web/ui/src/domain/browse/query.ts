// The browsing view in the URL, so a view can be shared: ?kind=, ?state=,
// ?search= and ?months=. Values left at their default are left out, and a
// value that cannot be read falls back to its default.

import { noticeKinds, noticeStates, type NoticeFilter } from './filter'

export interface BrowseQuery extends NoticeFilter {
  /** How many calendar months are shown, the current one included. */
  months: number
}

export const defaultMonths = 2
export const maxMonths = 120
export const maxSearchLength = 100

const browseKeys = ['kind', 'state', 'search', 'months'] as const

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((value) => value === raw) ?? fallback
}

function monthsOf(raw: string | null): number {
  if (raw === null || !/^\d{1,4}$/.test(raw)) {
    return defaultMonths
  }
  const months = Number(raw)
  return months < 1 ? defaultMonths : Math.min(months, maxMonths)
}

export function readBrowseQuery(params: URLSearchParams): BrowseQuery {
  return {
    kind: oneOf(params.get('kind'), noticeKinds, 'all'),
    state: oneOf(params.get('state'), noticeStates, 'all'),
    search: (params.get('search') ?? '').slice(0, maxSearchLength),
    months: monthsOf(params.get('months')),
  }
}

/** The search with the query set; other parameters, such as ?at=, are kept. */
export function writeBrowseQuery(current: URLSearchParams, query: BrowseQuery): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of browseKeys) {
    next.delete(key)
  }
  if (query.kind !== 'all') {
    next.set('kind', query.kind)
  }
  if (query.state !== 'all') {
    next.set('state', query.state)
  }
  if (query.search !== '') {
    next.set('search', query.search.slice(0, maxSearchLength))
  }
  const months = Math.min(Math.max(1, Math.floor(query.months)), maxMonths)
  if (months !== defaultMonths) {
    next.set('months', String(months))
  }
  return next
}
