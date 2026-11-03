// Which maintenance windows were in progress at a moment. The times decide,
// not the server's state field, so the same code serves now and time travel.

import type { MaintenanceWindow } from '../../api/plugins/types'

/** Windows that contain the moment: start at or before it, end after it. */
export function windowsAt(windows: MaintenanceWindow[], moment: number): MaintenanceWindow[] {
  return windows.filter((window) => window.start <= moment && moment < window.end)
}

/** Whether a window covers a service. A window naming no services covers them all. */
export function covers(window: MaintenanceWindow, key: string): boolean {
  return window.endpoints.length === 0 || window.endpoints.some((endpoint) => endpoint.key === key)
}

/** Of the windows covering a service, the one that ends last, so "until" is never too early. */
export function windowFor(windows: MaintenanceWindow[], key: string): MaintenanceWindow | null {
  let found: MaintenanceWindow | null = null
  for (const window of windows) {
    if (covers(window, key) && (found === null || window.end > found.end)) {
      found = window
    }
  }
  return found
}

/** Windows that overlap a period, such as one day of the record. */
export function windowsDuring(
  windows: MaintenanceWindow[],
  from: number,
  to: number,
): MaintenanceWindow[] {
  return windows.filter((window) => window.start < to && window.end > from)
}
