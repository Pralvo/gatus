// Filters for browsing notices and reports: by kind, by state and by words in
// the title. Every word must appear, in any order and case.

import type { NoticeItem } from '../notices/past'

export const noticeKinds = ['all', 'reports', 'maintenance'] as const
export type NoticeKind = (typeof noticeKinds)[number]

export const noticeStates = ['all', 'unresolved', 'resolved'] as const
export type NoticeState = (typeof noticeStates)[number]

export interface NoticeFilter {
  kind: NoticeKind
  state: NoticeState
  /** As typed; searchWords() reads it. */
  search: string
}

/** The words of a search, compared without case or width differences. */
export function searchWords(search: string): string[] {
  return search
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
}

/** Whether a title holds every word. No words matches every title. */
export function titleHas(title: string, words: string[]): boolean {
  const text = title.normalize('NFKC').toLowerCase()
  return words.every((word) => text.includes(word))
}

/** A report is resolved once its stage says so; maintenance once it has finished. */
export function isResolved(item: NoticeItem): boolean {
  return item.kind === 'report' ? item.stage === 'resolved' : item.state === 'finished'
}

/** Whether a notice passes the kind, state and search of a filter. */
export function matchesNotice(item: NoticeItem, filter: NoticeFilter): boolean {
  if (filter.kind === 'reports' && item.kind !== 'report') {
    return false
  }
  if (filter.kind === 'maintenance' && item.kind !== 'maintenance') {
    return false
  }
  if (filter.state !== 'all' && isResolved(item) !== (filter.state === 'resolved')) {
    return false
  }
  return titleHas(item.title, searchWords(filter.search))
}

/** Whether any filter differs from showing everything. */
export function isFiltered(filter: NoticeFilter): boolean {
  return filter.kind !== 'all' || filter.state !== 'all' || searchWords(filter.search).length > 0
}
