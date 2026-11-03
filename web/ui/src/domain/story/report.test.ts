import { describe, expect, it } from 'vitest'

import { at, event, report } from '../../test/fixtures'

import { reportStory, ribbonText, stageSentence } from './report'

const resolved = report({
  stage: 'resolved',
  updates: [
    { stage: 'resolved', at: at(80), message: 'Fixed.' },
    { stage: 'monitoring', at: at(58), message: 'Watching.' },
    { stage: 'identified', at: at(51), message: 'Found it.' },
    { stage: 'investigating', at: at(44), message: 'Looking.' },
  ],
  resolvedAt: at(80),
  updatedAt: at(80),
})

const media = {
  key: 'media',
  name: 'Media',
  events: [
    event('START', -500),
    event('UNHEALTHY', -200),
    event('HEALTHY', -190),
    event('UNHEALTHY', 40),
    event('HEALTHY', 62),
  ],
}
const blog = { key: 'blog', name: 'Blog', events: [event('START', -500), event('UNHEALTHY', 45)] }

describe('reportStory', () => {
  it('merges failures and updates, and says how soon it was published', () => {
    const story = reportStory(resolved, [media, blog], at(90))
    expect(story.items.map((item) => [item.source, item.text])).toEqual([
      ['Measured', 'Checks for Media began failing.'],
      ['Reported', 'Investigating: “Looking.” Published 4 minutes after checks first failed.'],
      ['Reported', 'Identified: “Found it.”'],
      ['Reported', 'Monitoring: “Watching.”'],
      ['Measured', 'Checks for Media passed again.'],
      ['Reported', 'Resolved: “Fixed.”'],
    ])
    expect(story).toMatchObject({
      firstFailureAt: at(40),
      failedMinutes: 22,
      publishedAfterMinutes: 4,
    })
  })

  it('leaves out services the report does not name and failures long before it', () => {
    const story = reportStory(resolved, [media, blog], at(90))
    expect(story.failures.map((interval) => interval.key)).toEqual(['media'])
  })

  it('counts overlapping failures once', () => {
    const both = report({
      ...resolved,
      endpoints: [...resolved.endpoints, { key: 'blog', name: 'Blog', impact: 'major' }],
    })
    const story = reportStory(both, [media, blog], at(90))
    expect(story.failedMinutes).toBe(40)
    expect(
      story.items.filter((item) => item.text === 'Checks for Blog began failing.'),
    ).toHaveLength(1)
  })

  it('says nothing about speed when checks failed after publication', () => {
    const late = {
      ...media,
      events: [event('START', -500), event('UNHEALTHY', 50), event('HEALTHY', 55)],
    }
    const story = reportStory(resolved, [late], at(90))
    expect(story.publishedAfterMinutes).toBeNull()
    expect(story.items.some((item) => item.text.includes('Published'))).toBe(false)
  })

  it('handles a report on an unknown endpoint and missing events', () => {
    const elsewhere = report({ endpoints: [{ key: 'search', name: 'Search', impact: 'major' }] })
    const story = reportStory(elsewhere, [media, { key: 'search', name: 'Search' }], at(90))
    expect(story).toMatchObject({ failures: [], firstFailureAt: null, failedMinutes: 0 })
    expect(story.items.map((item) => item.text)).toEqual([
      'Investigating: “We are looking into it.”',
    ])
  })
})

describe('stage panel and ribbon', () => {
  it('words a resolved report', () => {
    expect(stageSentence(resolved, 22)).toBe(
      'Resolved on 2 Nov 2026 at 14:20 UTC, 36 minutes after it was published. Checks failed for 22 minutes in all.',
    )
    expect(stageSentence(resolved, 0)).toMatch(/No checks failed\.$/)
    expect(stageSentence(resolved, null)).toMatch(/after it was published\.$/)
  })

  it.each([
    ['investigating', 'Investigating. We are looking into this problem.'],
    ['identified', 'Identified. The cause is known.'],
    ['monitoring', 'Monitoring. A fix is in place and being watched.'],
  ] as const)('words the %s stage', (stage, words) => {
    expect(stageSentence(report({ stage }), null)).toBe(words)
  })

  it('writes the ribbon list', () => {
    const story = reportStory(resolved, [media], at(90))
    expect(ribbonText(resolved, story, at(90))).toEqual([
      'Failed checks (measured): 13:40 to 14:02 UTC, 22 minutes.',
      'Report open: 13:44 to 14:20 UTC. Stages: 1 Investigating 13:44, 2 Identified 13:51, 3 Monitoring 13:58, 4 Resolved 14:20.',
    ])
  })

  it('writes the ribbon for an open report with no failures', () => {
    const open = report()
    expect(ribbonText(open, reportStory(open, [], at(90)), at(90))).toEqual([
      'Report open: 13:44 to now. Stages: 1 Investigating 13:44.',
    ])
  })
})
