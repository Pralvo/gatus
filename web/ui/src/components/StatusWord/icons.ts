import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  InfoIcon,
  ToolsIcon,
  XCircleIcon,
  type Icon,
} from '@primer/octicons-react'

import type { HeadlineKind } from '../../domain/headline/headline'
import type { ServiceState } from '../../domain/status/service'

const stateIcons = new Map<ServiceState, Icon>([
  ['down', XCircleIcon],
  ['failed', XCircleIcon],
  ['partial', AlertIcon],
  ['degraded', AlertIcon],
  ['slow', AlertIcon],
  ['maintenance', ToolsIcon],
  ['no-checks', ClockIcon],
  ['late', ClockIcon],
  ['working', CheckCircleIcon],
])

const headlineIcons = new Map<HeadlineKind, Icon>([
  ['unavailable', XCircleIcon],
  ['down', XCircleIcon],
  ['failed', XCircleIcon],
  ['partial', AlertIcon],
  ['degraded', AlertIcon],
  ['unnamed-report', AlertIcon],
  ['slow', AlertIcon],
  ['maintenance', ToolsIcon],
  ['stale', ClockIcon],
  ['working', CheckCircleIcon],
  ['no-checks', InfoIcon],
  ['nothing-configured', InfoIcon],
])

/** The icon that repeats a service's status word. */
export function stateIcon(state: ServiceState): Icon {
  return stateIcons.get(state) ?? InfoIcon
}

/** The icon beside the H1. */
export function headlineIcon(kind: HeadlineKind): Icon {
  return headlineIcons.get(kind) ?? InfoIcon
}
