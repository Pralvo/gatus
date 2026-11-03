// The Services list (spec 4.1 and section 5): configured groups, and above 8
// services a search, a filter and a sort, as Gatus had them. Groups keep
// their configured order; sorting by name or health lists every service in one box.

import type { FilterBy, SortBy } from '../../config/pageConfig'
import type { ServiceState, ServiceStatus } from '../status/service'

/** The search, filter and sort bar appears only above this many services. */
export const listControlsAbove = 8

export const noMatchMessage = 'No services match. Clear the search or show all.'

export function showsListControls(count: number): boolean {
  return count > listControlsAbove
}

export interface ServiceGroup {
  /** The configured group; '' for services without one, or for a flat sorted list. */
  name: string
  services: ServiceStatus[]
}

export interface ListOptions {
  query: string
  filterBy: FilterBy
  sortBy: SortBy
}

/** Name or group contains the search, ignoring case and outer spaces. */
export function matchesSearch(service: ServiceStatus, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  return (
    wanted === '' ||
    service.name.toLowerCase().includes(wanted) ||
    service.group.toLowerCase().includes(wanted)
  )
}

/** "failing": the latest check failed. "unstable": failing now, or any failure among the recent checks. */
export function matchesFilter(service: ServiceStatus, filterBy: FilterBy): boolean {
  switch (filterBy) {
    case 'failing':
      return service.failing
    case 'unstable':
      return service.failing || ['recovering', 'unsteady'].includes(service.trend.kind)
    default:
      return true
  }
}

const worstFirst: ServiceState[] = [
  'down',
  'failed',
  'partial',
  'degraded',
  'slow',
  'late',
  'maintenance',
  'no-checks',
  'working',
]

function byName(a: ServiceStatus, b: ServiceStatus): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
}

/** Groups in the order they first appear, keeping each group's configured order. */
export function groupServices(services: ServiceStatus[]): ServiceGroup[] {
  const groups = new Map<string, ServiceStatus[]>()
  for (const service of services) {
    groups.set(service.group, [...(groups.get(service.group) ?? []), service])
  }
  return [...groups].map(([name, members]) => ({ name, services: members }))
}

/** The services to show, filtered and sorted as chosen. */
export function listServices(services: ServiceStatus[], options: ListOptions): ServiceGroup[] {
  const shown = services.filter(
    (service) => matchesSearch(service, options.query) && matchesFilter(service, options.filterBy),
  )
  if (shown.length === 0) {
    return []
  }
  if (options.sortBy === 'group') {
    return groupServices(shown)
  }
  const sorted = [...shown].sort(
    options.sortBy === 'health'
      ? (a, b) => worstFirst.indexOf(a.state) - worstFirst.indexOf(b.state) || byName(a, b)
      : byName,
  )
  return [{ name: '', services: sorted }]
}

/** The heading of a group box: its name, or a plain one for services without a group. */
export function groupHeading(group: ServiceGroup, groupCount: number): string {
  if (group.name !== '') {
    return group.name
  }
  return groupCount === 1 ? 'All services' : 'Other services'
}
