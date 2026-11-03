import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../../admin/api/types'
import { at, report, results } from '../../test/fixtures'
import type { ServiceInput } from '../status/service'

import { changeBetween, impactLabel, isEmptyChange, sameAffected, withImpact } from './affected'
import { canMove, entryText, incidentChangeBetween, isFrozen, validMoves } from './moves'
import { checkSuggestions, previewHeadline, type DraftReport } from './preview'

function service(key: string, name: string, failing: number[] = []): ServiceInput {
  return {
    key,
    name,
    group: 'Supporting services',
    results: results(10, { last: 60, failing }),
    usualMs: 70,
  }
}

const website = service('website', 'Website')
const media = service('media', 'Media')
const failingMedia = service('media', 'Media', [50, 55, 60])

function draft(overrides: Partial<DraftReport> = {}): DraftReport {
  return {
    id: 'd1',
    title: 'Some images fail to load',
    stage: 'investigating',
    endpoints: [],
    updates: [{ at: at(58), stage: 'investigating', message: 'Looking.' }],
    publishedAt: null,
    ...overrides,
  }
}

function preview(choices: DraftReport, services = [website, media]) {
  return previewHeadline({
    loaded: true,
    services,
    reports: [],
    windows: [],
    draft: choices,
    now: at(61),
  })
}

describe('incident moves', () => {
  it('offers exactly the moves the plugin allows', () => {
    expect(validMoves('open')).toEqual(['mitigated', 'resolved', 'cancelled'])
    expect(validMoves('mitigated')).toEqual(['open', 'resolved', 'cancelled'])
    expect(validMoves('resolved')).toEqual(['open', 'closed'])
    expect(validMoves('cancelled')).toEqual(['open', 'closed'])
    expect(validMoves('closed')).toEqual([])
  })

  it('closes only from resolved or cancelled, and freezes a closed incident', () => {
    expect(canMove('open', 'closed')).toBe(false)
    expect(canMove('mitigated', 'closed')).toBe(false)
    expect(canMove('resolved', 'closed')).toBe(true)
    expect(canMove('closed', 'open')).toBe(false)
    expect(isFrozen('closed')).toBe(true)
    expect(isFrozen('resolved')).toBe(false)
  })

  it('words timeline entries', () => {
    const entry = (overrides: Partial<TimelineEntry>): TimelineEntry => ({
      seq: 1,
      at: at(0),
      actor: 'alice',
      kind: 'created',
      from: '',
      to: '',
      note: '',
      ...overrides,
    })
    expect(entryText(entry({}))).toBe('opened the incident')
    expect(entryText(entry({ kind: 'state', from: 'open', to: 'mitigated' }))).toBe(
      'moved it from Open to Mitigated',
    )
    expect(entryText(entry({ kind: 'commander', to: 'bob' }))).toBe('made “bob” the commander')
    expect(entryText(entry({ kind: 'commander' }))).toBe('cleared the commander')
    expect(entryText(entry({ kind: 'report-link' }))).toBe('removed the report link')
  })
})

describe('incident edits', () => {
  it('sends only the fields that changed, and an emptied commander as a clear', () => {
    const saved = {
      title: 'Image store errors',
      severity: 'major' as const,
      commander: 'bob',
      reportId: '',
      postmortem: '',
    }
    expect(incidentChangeBetween(saved, { ...saved, title: 'Image store errors ' })).toEqual({})
    expect(incidentChangeBetween(saved, { ...saved, severity: 'minor', commander: '' })).toEqual({
      severity: 'minor',
      commander: '',
    })
  })
})

describe('affected services', () => {
  it('sets, replaces and clears an impact in place', () => {
    const one = withImpact([], 'media', 'partial')
    expect(one).toEqual([{ key: 'media', impact: 'partial' }])
    const two = withImpact(one, 'website', 'major')
    expect(withImpact(two, 'media', 'degraded')).toEqual([
      { key: 'media', impact: 'degraded' },
      { key: 'website', impact: 'major' },
    ])
    expect(withImpact(two, 'media', null)).toEqual([{ key: 'website', impact: 'major' }])
  })

  it('compares lists in any order', () => {
    const a = [
      { key: 'media', impact: 'partial' as const },
      { key: 'blog', impact: 'major' as const },
    ]
    expect(sameAffected(a, [...a].reverse())).toBe(true)
    expect(sameAffected(a, withImpact(a, 'blog', 'degraded'))).toBe(false)
    expect(impactLabel('partial')).toBe('Partial outage')
    expect(impactLabel(null)).toBe('Not affected')
  })

  it('sends only what changed', () => {
    const saved = {
      title: 'Slow images',
      endpoints: [{ key: 'media', impact: 'partial' as const }],
    }
    expect(isEmptyChange(changeBetween(saved, { ...saved, title: ' Slow images ' }))).toBe(true)
    expect(changeBetween(saved, { ...saved, title: 'Images fail' })).toEqual({
      title: 'Images fail',
    })
    expect(changeBetween(saved, { ...saved, endpoints: [] })).toEqual({ endpoints: [] })
  })
})

describe('public preview', () => {
  it('follows the impact chosen for a service', () => {
    const partial = preview(draft({ endpoints: [{ key: 'media', impact: 'partial' }] }))
    expect(partial.headline.title).toBe('Media is partly down')
    expect(partial.headline.detail).toBe('Reported at 13:58 UTC: “Some images fail to load”.')
    expect(partial.affected).toEqual([
      { key: 'media', name: 'Media', word: 'Partly down', tone: 'severe' },
    ])
    const major = preview(draft({ endpoints: [{ key: 'media', impact: 'major' }] }))
    expect(major.headline.title).toBe('Media is down')
    expect(major.affected[0]?.word).toBe('Down')
  })

  it('treats a draft as published now, and an unnamed report as looking into a problem', () => {
    const found = preview(draft({ updates: [] }))
    expect(found.headline.title).toBe('We are looking into a problem')
    expect(found.headline.detail).toBe('Reported at 14:01 UTC: “Some images fail to load”.')
  })

  it('lets failing checks outrank a partial report, as the status page does', () => {
    const found = preview(draft({ endpoints: [{ key: 'website', impact: 'partial' }] }), [
      website,
      failingMedia,
    ])
    expect(found.headline.title).toBe('Media failed its latest check')
  })

  it('replaces the report’s own public copy and ignores a resolved report', () => {
    const publicCopy = report({
      id: 'd1',
      endpoints: [{ key: 'website', name: 'Website', impact: 'major' }],
    })
    const choices = draft({ endpoints: [{ key: 'media', impact: 'degraded' }] })
    const found = previewHeadline({
      loaded: true,
      services: [website, media],
      reports: [publicCopy],
      windows: [],
      draft: choices,
      now: at(61),
    })
    expect(found.headline.title).toBe('Media is degraded')
    const resolved = preview({ ...choices, stage: 'resolved', updates: [] })
    expect(resolved.counts).toBe(false)
    expect(resolved.headline.title).toBe('Everything is working')
  })

  it('names a service this page does not monitor by its key and impact word', () => {
    const found = preview(draft({ endpoints: [{ key: 'core_queue', impact: 'maintenance' }] }))
    expect(found.affected).toEqual([
      { key: 'core_queue', name: 'core_queue', word: 'Maintenance', tone: 'neutral' },
    ])
  })
})

describe('from the checks', () => {
  it('lists failing services the report does not name yet', () => {
    expect(checkSuggestions([website, failingMedia], [], at(61))).toEqual([
      {
        key: 'media',
        name: 'Media',
        sentence: 'Media has failed its last 3 checks, since 13:50 UTC.',
      },
    ])
    expect(
      checkSuggestions([website, failingMedia], [{ key: 'media', impact: 'partial' }], at(61)),
    ).toEqual([])
  })

  it('words a single failure with its time', () => {
    const once = service('media', 'Media', [60])
    expect(checkSuggestions([once], [], at(61))[0]?.sentence).toBe(
      'Media failed its latest check, at 14:00 UTC.',
    )
  })
})
