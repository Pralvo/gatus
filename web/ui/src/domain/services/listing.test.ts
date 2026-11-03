import { describe, expect, it } from 'vitest'

import { at, results } from '../../test/fixtures'
import { momentAt, serviceStatuses, type ServiceInput } from '../status/service'

import {
  groupHeading,
  groupServices,
  listServices,
  matchesFilter,
  matchesSearch,
  showsListControls,
} from './listing'

const now = at(61)

function input(key: string, name: string, group: string, failing: number[] = []): ServiceInput {
  return { key, name, group, results: results(8, { last: 60, failing }), usualMs: 70 }
}

const statuses = serviceStatuses(
  [
    input('website', 'Website', 'Public site'),
    input('media', 'Media', 'Supporting services', [60]),
    input('blog', 'Blog', 'Public site', [45]),
    input('database', 'Database', 'Supporting services'),
  ],
  momentAt(now, [], []),
)

function names(groups: ReturnType<typeof listServices>): string[][] {
  return groups.map((group) => [group.name, ...group.services.map((service) => service.name)])
}

describe('services listing', () => {
  it('shows the bar only above 8 services', () => {
    expect(showsListControls(8)).toBe(false)
    expect(showsListControls(9)).toBe(true)
  })

  it('keeps configured groups and their order', () => {
    expect(names(groupServices(statuses))).toEqual([
      ['Public site', 'Website', 'Blog'],
      ['Supporting services', 'Media', 'Database'],
    ])
  })

  it('searches names and groups, ignoring case', () => {
    const [blog] = statuses.filter((service) => service.key === 'blog')
    expect(blog && matchesSearch(blog, '  BLO ')).toBe(true)
    expect(blog && matchesSearch(blog, 'public')).toBe(true)
    expect(blog && matchesSearch(blog, 'media')).toBe(false)
  })

  it('filters failing and unstable services', () => {
    const failing = statuses.filter((service) => matchesFilter(service, 'failing'))
    expect(failing.map((service) => service.name)).toEqual(['Media'])
    const unstable = statuses.filter((service) => matchesFilter(service, 'unstable'))
    expect(unstable.map((service) => service.name)).toEqual(['Media', 'Blog'])
  })

  it('sorts by name or by health in one box', () => {
    expect(names(listServices(statuses, { query: '', filterBy: 'none', sortBy: 'name' }))).toEqual([
      ['', 'Blog', 'Database', 'Media', 'Website'],
    ])
    expect(
      names(listServices(statuses, { query: '', filterBy: 'none', sortBy: 'health' })),
    ).toEqual([['', 'Media', 'Blog', 'Database', 'Website']])
  })

  it('gives nothing when nothing matches', () => {
    expect(listServices(statuses, { query: 'zzz', filterBy: 'none', sortBy: 'group' })).toEqual([])
  })

  it('names a box without a group', () => {
    expect(groupHeading({ name: '', services: [] }, 1)).toBe('All services')
    expect(groupHeading({ name: '', services: [] }, 2)).toBe('Other services')
    expect(groupHeading({ name: 'Public site', services: [] }, 2)).toBe('Public site')
  })
})
