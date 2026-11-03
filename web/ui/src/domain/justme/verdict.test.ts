import { describe, expect, it } from 'vitest'

import { at, results } from '../../test/fixtures'
import { momentAt, serviceStatuses } from '../status/service'

import {
  monitorFor,
  monitorText,
  probedKeys,
  verdict,
  youText,
  type JustMeRow,
  type ProbeOutcome,
} from './verdict'

const services = serviceStatuses(
  [
    { key: 'website', name: 'Website', group: '', results: results(6, { last: 60 }) },
    { key: 'media', name: 'Media', group: '', results: results(6, { last: 60, failing: [60] }) },
  ],
  momentAt(at(61), [], []),
)

const reached: ProbeOutcome = { reached: true, ms: 182 }
const missed: ProbeOutcome = { reached: false, timedOut: true }

function row(page: string, you: ProbeOutcome): JustMeRow {
  return { page, you, monitor: monitorFor(page, services) }
}

describe('matching browser checks to services', () => {
  it('matches by name, ignoring case and spaces', () => {
    expect(monitorFor(' website ', services)).toEqual({
      kind: 'passing',
      key: 'website',
      name: 'Website',
    })
    expect(monitorFor('Media', services)).toMatchObject({ kind: 'failing' })
    expect(monitorFor('The blog', services)).toEqual({ kind: 'not-monitored' })
    expect([...probedKeys(['Website', 'The blog'], services)]).toEqual(['website'])
  })
})

describe('verdict', () => {
  it('all reached and the monitor passing', () => {
    const found = verdict([row('Website', reached), row('The blog', reached), row('x', reached)])
    expect(found.kind).toBe('all-reached')
    expect(found.text).toBe(
      'Your browser reached all three pages. If something still fails for you, the problem is likely on your side: a browser extension, network filter or VPN.',
    )
    expect(verdict([row('Website', reached)]).text).toMatch(/^Your browser reached the page\./)
  })

  it('you fail while the monitor passes', () => {
    expect(verdict([row('Website', missed), row('The blog', reached)])).toMatchObject({
      kind: 'you-fail',
      tone: 'warning',
      text: 'Our monitor reaches these pages, but your browser could not. The problem is likely between you and Pralvo: your network, a firewall or a VPN.',
    })
  })

  it('you pass while the monitor fails', () => {
    expect(verdict([row('Website', reached), row('Media', reached)])).toMatchObject({
      kind: 'monitor-fails',
      text: 'Your browser reached these pages, but our monitor could not. It may affect some places and not others.',
    })
  })

  it('both fail on the same page', () => {
    expect(verdict([row('Website', reached), row('Media', missed)])).toMatchObject({
      kind: 'both-fail',
      tone: 'critical',
      text: "It's not just you. Our monitor cannot reach these pages either.",
    })
  })
})

describe('row words', () => {
  it('says what the browser saw', () => {
    expect(youText(reached, 10_000)).toBe('Reached in 182 ms')
    expect(youText(missed, 10_000)).toBe('Not reached in 10 s')
    expect(youText({ reached: false, timedOut: false }, 10_000)).toBe('Not reached')
  })

  it('says what the monitor saw', () => {
    expect(monitorText(monitorFor('Media', services))).toBe('Media: failing')
    expect(monitorText(monitorFor('Website', services))).toBe('Website: passing')
    expect(monitorText({ kind: 'not-monitored' })).toBe('Not monitored')
  })
})
