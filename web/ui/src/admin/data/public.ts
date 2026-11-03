// What visitors' pages load, read by the admin for "From the checks", the
// service list and the public preview: the minute cycle, plus each service's
// events and usual speed, joined by the domain layer exactly as the home page
// joins them.

import type { MaintenanceWindow, Report } from '../../api/plugins/types'
import { useMinuteCycle, useNow } from '../../data/cycle'
import { useServiceEvents, useUsualSpeeds } from '../../data/service'
import { serviceInputs, type ServiceInput } from '../../domain/status/service'

export interface PublicPicture {
  /** True once the service checks have loaded. */
  loaded: boolean
  /** True when the checks could not be loaded. */
  failed: boolean
  services: ServiceInput[]
  /** Published reports, page 1, as visitors receive them. */
  reports: Report[]
  windows: MaintenanceWindow[]
  now: number
}

const none: never[] = []

export function usePublicPicture(): PublicPicture {
  const cycle = useMinuteCycle({ live: true })
  const now = useNow(30_000)
  const statuses = cycle.statuses.data ?? none
  const keys = statuses.map((status) => status.key)
  const events = useServiceEvents(keys)
  const usual = useUsualSpeeds(keys)
  return {
    loaded: cycle.statuses.data !== undefined,
    failed: cycle.statuses.isError && cycle.statuses.data === undefined,
    services: serviceInputs(statuses, events.byKey, usual.byKey),
    reports: cycle.reports.data?.reports ?? none,
    windows: cycle.maintenance.data ?? none,
    now,
  }
}

export interface ListedService {
  key: string
  name: string
  group: string
}

/** The monitored services by name, for choosing affected services; empty until loaded. */
export function useServiceList(): ListedService[] {
  const cycle = useMinuteCycle({ live: true })
  return serviceInputs(cycle.statuses.data ?? none).map(({ key, name, group }) => ({
    key,
    name,
    group,
  }))
}
