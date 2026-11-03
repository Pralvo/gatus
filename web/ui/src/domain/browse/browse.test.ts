import { describe, expect, it } from 'vitest'

import type { Report, ReportPage } from '../../api/plugins/types'
import { report } from '../../test/fixtures'
import type { NoticeItem } from '../notices/past'

import { isFiltered, matchesNotice, searchWords, type NoticeFilter } from './filter'
import { groupByMonth, shownFrom, startOfUtcMonth, utcMonth } from './months'
import { maxReportPages, mergeReports, needOlderPage, olderMayExist } from './pages'
import { defaultMonths, maxMonths, readBrowseQuery, writeBrowseQuery } from './query'

const utc = (month: number, day: number, hour = 12) => Date.UTC(2026, month - 1, day, hour)
const all: NoticeFilter = { kind: 'all', state: 'all', search: '' }

const openReport: NoticeItem = {
  kind: 'report',
  id: 'r1',
  title: 'Images were slow to load',
  stage: 'investigating',
  at: utc(11, 2),
}
const doneReport: NoticeItem = {
  ...openReport,
  id: 'r2',
  title: 'Sign-in failed',
  stage: 'resolved',
}
const publishedReport: NoticeItem = { ...openReport, id: 'r3', title: 'Feeds late', stage: null }
const running: NoticeItem = {
  kind: 'maintenance',
  title: 'Database upgrade',
  state: 'in-progress',
  at: utc(11, 1),
  end: utc(11, 3),
}
const finished: NoticeItem = { ...running, title: 'Media move', state: 'finished' }
const everything = [openReport, doneReport, publishedReport, running, finished]
const titles = (filter: Partial<NoticeFilter>) =>
  everything.filter((item) => matchesNotice(item, { ...all, ...filter })).map((item) => item.title)

describe('notice filters', () => {
  it('keeps everything with no filter', () => {
    expect(titles({})).toHaveLength(5)
    expect(isFiltered(all)).toBe(false)
    expect(isFiltered({ ...all, search: '   ' })).toBe(false)
  })

  it('filters by kind', () => {
    expect(titles({ kind: 'reports' })).toEqual([
      'Images were slow to load',
      'Sign-in failed',
      'Feeds late',
    ])
    expect(titles({ kind: 'maintenance' })).toEqual(['Database upgrade', 'Media move'])
  })

  it('reads resolved reports and finished maintenance as resolved, the rest as not', () => {
    expect(titles({ state: 'resolved' })).toEqual(['Sign-in failed', 'Media move'])
    expect(titles({ state: 'unresolved' })).toEqual([
      'Images were slow to load',
      'Feeds late',
      'Database upgrade',
    ])
    expect(titles({ kind: 'maintenance', state: 'unresolved' })).toEqual(['Database upgrade'])
  })

  it('searches titles for every word, in any case and order', () => {
    expect(titles({ search: 'SLOW images' })).toEqual(['Images were slow to load'])
    expect(titles({ search: '  media  ' })).toEqual(['Media move'])
    expect(searchWords('Ｍｅｄｉａ\tMove')).toEqual(['media', 'move'])
    expect(titles({ search: 'Ｍｅｄｉａ' })).toEqual(['Media move'])
  })

  it('finds nothing when one word is missing or the kind rules it out', () => {
    expect(titles({ search: 'images fast' })).toEqual([])
    expect(titles({ search: 'database', kind: 'reports' })).toEqual([])
    expect(titles({ search: 'sign-in', state: 'unresolved' })).toEqual([])
  })

  it('treats search text as text, not a pattern', () => {
    expect(titles({ search: '.*' })).toEqual([])
    expect(titles({ search: '(' })).toEqual([])
  })
})

describe('months', () => {
  it('starts each month at midnight UTC on the first', () => {
    expect(startOfUtcMonth(utc(11, 30, 23))).toBe(Date.UTC(2026, 10, 1))
    expect(utcMonth(utc(1, 5))).toBe('January 2026')
  })

  it('shows the current month and the ones before it, across a year end', () => {
    expect(shownFrom(utc(11, 4), 1)).toBe(Date.UTC(2026, 10, 1))
    expect(shownFrom(utc(11, 4), 2)).toBe(Date.UTC(2026, 9, 1))
    expect(shownFrom(utc(2, 4), 3)).toBe(Date.UTC(2025, 11, 1))
    expect(shownFrom(utc(11, 4), 0)).toBe(Date.UTC(2026, 10, 1))
  })

  it('groups by month and day, newest first, listing only days that have entries', () => {
    const ats = [utc(10, 3), utc(11, 2, 9), utc(9, 30, 23), utc(11, 2, 15), utc(10, 31)]
    const months = groupByMonth(ats, (at) => at)
    expect(months.map((month) => utcMonth(month.start))).toEqual([
      'November 2026',
      'October 2026',
      'September 2026',
    ])
    expect(months[0]?.days).toEqual([{ start: Date.UTC(2026, 10, 2), entries: [ats[3], ats[1]] }])
    expect(months[1]?.days.map((day) => day.entries)).toEqual([[ats[4]], [ats[0]]])
  })

  it('gives no months for no entries', () => {
    expect(groupByMonth([], (at: number) => at)).toEqual([])
  })
})

describe('the view in the URL', () => {
  it('reads every value it knows', () => {
    const query = readBrowseQuery(
      new URLSearchParams('kind=maintenance&state=resolved&search=db+up&months=5'),
    )
    expect(query).toEqual({ kind: 'maintenance', state: 'resolved', search: 'db up', months: 5 })
  })

  it('falls back to the defaults for values it cannot read', () => {
    for (const bad of ['kind=all-of-it', 'state=RESOLVED', 'months=0', 'months=-2', 'months=2.5']) {
      const query = readBrowseQuery(new URLSearchParams(bad))
      expect(query).toEqual({ kind: 'all', state: 'all', search: '', months: defaultMonths })
    }
    expect(readBrowseQuery(new URLSearchParams('months=9999')).months).toBe(maxMonths)
    expect(readBrowseQuery(new URLSearchParams(`search=${'x'.repeat(500)}`)).search).toHaveLength(
      100,
    )
  })

  it('writes only what differs from the default and keeps other parameters', () => {
    const current = new URLSearchParams('at=2026-11-02T13:49Z&kind=reports&q=media')
    const next = writeBrowseQuery(current, {
      kind: 'all',
      state: 'unresolved',
      search: 'slow',
      months: defaultMonths,
    })
    expect(next.toString()).toBe('at=2026-11-02T13%3A49Z&q=media&state=unresolved&search=slow')
    expect(writeBrowseQuery(new URLSearchParams(), { ...all, months: 3 }).toString()).toBe(
      'months=3',
    )
  })

  it('round-trips a written view', () => {
    const query = {
      kind: 'reports' as const,
      state: 'resolved' as const,
      search: 'a&b=c',
      months: 4,
    }
    expect(readBrowseQuery(writeBrowseQuery(new URLSearchParams(), query))).toEqual(query)
  })
})

describe('report pages', () => {
  const from = Date.UTC(2026, 9, 1)
  const done = (id: string, updatedAt: number): Report =>
    report({ id, stage: 'resolved', updatedAt, resolvedAt: updatedAt })
  const pageOf = (reports: Report[], more: boolean, page = 1): ReportPage => ({
    reports,
    page,
    more,
  })

  it('asks for the next page while the last report shown is in the months shown', () => {
    expect(needOlderPage([pageOf([done('a', utc(10, 20))], true)], from)).toBe(true)
  })

  it('asks for the next page while the last page ends with an unresolved report', () => {
    const open = report({ id: 'o', stage: 'investigating', updatedAt: utc(1, 1) })
    expect(needOlderPage([pageOf([open], true)], from)).toBe(true)
  })

  it('stops once the last report is older than the months shown', () => {
    expect(needOlderPage([pageOf([done('a', utc(9, 20))], true)], from)).toBe(false)
  })

  it('stops when the server has no more, gives an empty page, or the page limit is reached', () => {
    expect(needOlderPage([], from)).toBe(false)
    expect(needOlderPage([pageOf([done('a', utc(10, 20))], false)], from)).toBe(false)
    expect(needOlderPage([pageOf([], true)], from)).toBe(false)
    const many = Array.from({ length: maxReportPages }, (_, index) =>
      pageOf([done(`r${String(index)}`, utc(10, 20))], true, index + 1),
    )
    expect(needOlderPage(many, from)).toBe(false)
    expect(needOlderPage(many.slice(1), from)).toBe(true)
  })

  it('merges pages by id, keeping the first copy', () => {
    const fresh = done('a', utc(11, 1))
    const merged = mergeReports([fresh], [done('a', utc(10, 1)), done('b', utc(10, 2))])
    expect(merged.map((item) => [item.id, item.updatedAt])).toEqual([
      ['a', utc(11, 1)],
      ['b', utc(10, 2)],
    ])
  })

  it('offers older entries only when some are hidden or the server has more', () => {
    expect(olderMayExist([utc(10, 5)], from, false)).toBe(false)
    expect(olderMayExist([utc(9, 5)], from, false)).toBe(true)
    expect(olderMayExist([], from, true)).toBe(true)
  })
})
