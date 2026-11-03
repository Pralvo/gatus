// "Compared with normal" on the service page (spec 4.2 item 3): three figures,
// now, usual and the share of failed checks in 30 days, with the sentence from
// spec section 7. A check that does not measure response time shows only the
// failed share, since now and usual would be zero.

import type { Comparison } from '../status/trend'
import { comparisonText } from '../status/trend'
import { durationText } from '../time/format'

export interface Figure {
  label: string
  /** The figure itself; null when it is not known yet. */
  value: string | null
}

export interface NormalFigures {
  /** Now and usual; empty when the check does not measure response time. */
  speeds: Figure[]
  /** "Failed checks (30 days)". */
  failed: Figure
  /** "As fast as usual: 72 ms now, 70 ms usually." */
  sentence: string
}

/**
 * The share of failed checks from the 30-day uptime (0 to 1): "0.5%", "0%",
 * "under 0.1%" for a small but real share, "100%". Null while unknown.
 */
export function failedShareText(uptime: number | null | undefined): string | null {
  if (uptime === null || uptime === undefined || !Number.isFinite(uptime)) {
    return null
  }
  const failed = Math.min(Math.max(1 - uptime, 0), 1) * 100
  if (failed === 0) {
    return '0%'
  }
  if (failed < 0.1) {
    return 'under 0.1%'
  }
  return `${failed.toFixed(1).replace(/\.0$/, '')}%`
}

function speed(ms: number | null): string | null {
  return ms === null ? null : durationText(ms)
}

/** The three figures and the sentence. */
export function normalFigures(comparison: Comparison, uptime: number | null): NormalFigures {
  const failed = { label: 'Failed checks (30 days)', value: failedShareText(uptime) }
  const speeds =
    comparison.kind === 'not-measured'
      ? []
      : [
          { label: 'Now (last 3 passing checks)', value: speed(comparison.nowMs) },
          { label: 'Usual (median, 7 days)', value: speed(comparison.usualMs) },
        ]
  return { speeds, failed, sentence: comparisonText(comparison) }
}
