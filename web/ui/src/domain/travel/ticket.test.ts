import { describe, expect, it } from 'vitest'

import { at, report } from '../../test/fixtures'
import type { Headline } from '../headline/headline'
import { reportsAt } from '../notices/reports'
import { atLink } from '../time/at'

import { firstSeenAt, reportTicketText, ticketReportLine, ticketText } from './ticket'

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

describe('reportTicketText', () => {
  const resolved = report({
    stage: 'resolved',
    endpoints: [
      { key: 'media', name: 'Media', impact: 'degraded' },
      { key: 'blog', name: 'Blog', impact: 'major' },
    ],
    updates: [
      { stage: 'resolved', at: at(80), message: 'Fixed.' },
      { stage: 'investigating', at: at(44), message: 'Looking.' },
    ],
    resolvedAt: at(80),
    updatedAt: at(80),
  })

  it('names the moment, the report, its stage sentence, the services and the link', () => {
    expect(
      reportTicketText({
        report: resolved,
        sentence: 'Resolved on 2 Nov 2026 at 14:20 UTC.',
        now: at(85),
        link: 'https://status.pralvo.com/reports/r1',
        siteName: 'Pralvo status',
      }),
    ).toBe(
      [
        'Pralvo status at 2 Nov 2026, 14:25 UTC:',
        'Report: “Images were slow to load” (Resolved, 14:20 UTC).',
        'Resolved on 2 Nov 2026 at 14:20 UTC.',
        'Affected: Media (Degraded), Blog (Down).',
        'https://status.pralvo.com/reports/r1',
      ].join('\n'),
    )
  })

  it('leaves out the services line when the report names none', () => {
    const text = reportTicketText({
      report: report({ endpoints: [], updates: [] }),
      sentence: 'Investigating. We are looking into this problem.',
      now: at(50),
      link: 'L',
      siteName: 'S',
    })
    expect(text).toBe(
      [
        'S at 2 Nov 2026, 13:50 UTC:',
        'Report: “Images were slow to load” (Investigating, 13:44 UTC).',
        'Investigating. We are looking into this problem.',
        'L',
      ].join('\n'),
    )
  })
})

describe('firstSeenAt', () => {
  it('is the publication minute when it falls on a whole minute', () => {
    expect(firstSeenAt(report())).toBe(at(44))
  })

  it('rounds up so time travel already counts the report', () => {
    const halfPast = report({ publishedAt: at(44) + 30_000, updates: [] })
    expect(firstSeenAt(halfPast)).toBe(at(45))
  })

  it('never goes before publication even if an update claims an earlier time', () => {
    const early = report({
      updates: [{ stage: 'investigating', at: at(40), message: 'x' }],
    })
    expect(firstSeenAt(early)).toBe(at(44))
  })
})
