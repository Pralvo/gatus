import { describe, expect, it } from 'vitest'

import { at, report } from '../../test/fixtures'
import type { Headline } from '../headline/headline'
import { reportsAt } from '../notices/reports'
import { atLink } from '../time/at'

import { ticketReportLine, ticketText } from './ticket'

const failed: Headline = {
  kind: 'failed',
  rank: 3,
  tone: 'danger',
  title: 'Media had failed its latest check',
  detail:
    'Its checks had failed since 13:40 UTC: answered with error 503; it needs a code below 500.',
  keys: ['media'],
}

describe('ticketText', () => {
  it('matches the spec example', () => {
    const open = reportsAt([report()], at(50))
    expect(
      ticketText({
        at: at(50),
        headline: failed,
        reports: open,
        link: atLink('https://status.pralvo.com', at(50)),
        siteName: 'Pralvo status',
      }),
    ).toBe(
      [
        'Pralvo status at 2 Nov 2026, 13:50 UTC:',
        'Media had failed its latest check.',
        'Its checks had failed since 13:40 UTC: answered with error 503; it needs a code below 500.',
        'Report: “Images were slow to load” (Investigating, 13:44 UTC).',
        'https://status.pralvo.com/?at=2026-11-02T13:50Z',
      ].join('\n'),
    )
  })

  it('leaves out a missing detail and reports', () => {
    const working: Headline = {
      ...failed,
      kind: 'nothing-configured',
      title: 'No services are monitored on this page',
      detail: null,
    }
    expect(
      ticketText({ at: at(50), headline: working, reports: [], link: 'L', siteName: 'S' }),
    ).toBe('S at 2 Nov 2026, 13:50 UTC:\nNo services are monitored on this page.\nL')
  })

  it('gives only the time when the stage at the moment is unknown', () => {
    const listItem = report({
      stage: 'monitoring',
      updates: [{ stage: 'monitoring', at: at(70), message: 'x' }],
      updatedAt: at(70),
    })
    const [open] = reportsAt([listItem], at(50))
    expect(open === undefined ? '' : ticketReportLine(open, at(50))).toBe(
      'Report: “Images were slow to load” (13:44 UTC).',
    )
  })
})
