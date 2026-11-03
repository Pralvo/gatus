// Typed call to the maintenance-windows plugin: GET /api/v1/maintenance.

import { getJSON, ResponseFormatError, type RequestOptions } from '../http'

import { isRecord, readList, readName, readOneOf, readText, readTime } from './read'
import type { MaintenanceWindow, WindowEndpoint, WindowState } from './types'

const url = '/api/v1/maintenance'
const windowStates: readonly WindowState[] = ['upcoming', 'in-progress', 'finished']

function readWindowEndpoint(value: unknown): WindowEndpoint | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const key = readName(value.key)
  return key === undefined ? undefined : { key, name: readName(value.name) ?? key }
}

/** Checks one window. A window without a title, a valid state or an end after its start is dropped. */
export function readWindow(value: unknown): MaintenanceWindow | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const title = readText(value.title)
  const start = readTime(value.start)
  const end = readTime(value.end)
  const state = readOneOf(value.state, windowStates)
  if (title === undefined || start === undefined || end === undefined || state === undefined) {
    return undefined
  }
  if (end <= start) {
    return undefined
  }
  const window: MaintenanceWindow = {
    title,
    start,
    end,
    state,
    endpoints: readList(value.endpoints, readWindowEndpoint),
  }
  const details = readText(value.details)
  if (details !== undefined && details !== '') {
    window.details = details
  }
  return window
}

/** Every announced window, oldest start first. */
export async function getMaintenance(options?: RequestOptions): Promise<MaintenanceWindow[]> {
  const body = await getJSON<unknown>(url, options)
  if (!isRecord(body) || !Array.isArray(body.windows)) {
    throw new ResponseFormatError(url, 'no windows list')
  }
  return readList(body.windows, readWindow).sort((a, b) => a.start - b.start)
}
