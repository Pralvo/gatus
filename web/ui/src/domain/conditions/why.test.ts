import { describe, expect, it } from 'vitest'

import { result } from '../../test/fixtures'

import { conditionReason, whyFailed, whyText } from './why'

describe('conditionReason, the spec table', () => {
  it.each([
    ['[STATUS] (503) < 500', 'answered with error 503; it needs a code below 500'],
    ['[STATUS] (503) == 204', 'answered with error 503; it needs 204'],
    ['[STATUS] (302) == 200', 'answered with 302; it needs 200'],
    ['[STATUS] (0) < 500', 'gave no answer; it needs a code below 500'],
    ['[STATUS] (200) != 200', 'answered with 200; it needs any code but 200'],
    ['[STATUS] (500) <= 499', 'answered with error 500; it needs a code of 499 or below'],
    ['[RESPONSE_TIME] (6200) < 5000', 'took 6.2 s; the limit is 5 s'],
    ['[RESPONSE_TIME] (640) < 300', 'took 640 ms; the limit is 300 ms'],
    [
      '[CERTIFICATE_EXPIRATION] (120h) > 168h',
      'its security certificate expires in 5 days; it needs more than 7',
    ],
    [
      '[CERTIFICATE_EXPIRATION] (119h59m30s) > 168h',
      'its security certificate expires in 4 days; it needs more than 7',
    ],
    [
      '[CERTIFICATE_EXPIRATION] (5h) > 168h',
      'its security certificate expires in 5 hours; it needs more than 7 days',
    ],
    [
      '[CERTIFICATE_EXPIRATION] (0s) >= 36h',
      'its security certificate has expired; it needs at least 36 hours',
    ],
    [
      '[DOMAIN_EXPIRATION] (240h) > 720h',
      'its domain registration expires in 10 days; it needs more than 30',
    ],
    ['[CONNECTED] (false) == true', 'it could not connect'],
  ])('says %s as plain words', (raw, text) => {
    expect(conditionReason(raw)).toEqual({ text, code: false })
  })

  it.each([
    '[BODY].status (DOWN) == UP',
    '[STATUS] (503) == any(200, 201)',
    '[RESPONSE_TIME] (20) > 50',
    '[CERTIFICATE_EXPIRATION] (soon) > 168h',
    '[DNS_RCODE] (SERVFAIL) == NOERROR',
    '<b>not html</b>',
  ])('keeps %s as written, in code style', (raw) => {
    expect(conditionReason(raw)).toEqual({ text: raw, code: true })
  })
})

describe('whyFailed', () => {
  it('describes a timeout from the time the check waited', () => {
    const timedOut = result({
      minute: 0,
      ok: false,
      ms: 30_000,
      errors: ['Get "https://pralvo.com/": context deadline exceeded (Client.Timeout)'],
      conditions: [{ condition: '[STATUS] (0) == 200', success: false }],
    })
    expect(whyFailed(timedOut)).toEqual([{ text: 'no answer within 30 seconds', code: false }])
  })

  it('says "in time" when a timeout has no duration', () => {
    const timedOut = result({ minute: 0, ok: false, ms: 0, errors: ['i/o timeout'] })
    expect(whyText(whyFailed(timedOut))).toBe('no answer in time')
  })

  it('keeps any other error as written', () => {
    const refused = result({ minute: 0, ok: false, errors: ['dial tcp: connection refused', ''] })
    expect(whyFailed(refused)).toEqual([{ text: 'dial tcp: connection refused', code: true }])
  })

  it('lists only the failing conditions, once each', () => {
    const failed = result({
      minute: 0,
      ok: false,
      conditions: [
        { condition: '[STATUS] (503) < 500', success: false },
        { condition: '[RESPONSE_TIME] < 5000', success: true },
        { condition: '[STATUS] (503) < 500', success: false },
        { condition: '[RESPONSE_TIME] (6200) < 5000', success: false },
      ],
    })
    expect(whyText(whyFailed(failed))).toBe(
      'answered with error 503; it needs a code below 500, and took 6.2 s; the limit is 5 s',
    )
  })

  it('gives nothing for a passing or missing result', () => {
    expect(whyFailed(result({ minute: 0 }))).toEqual([])
    expect(whyFailed(undefined)).toEqual([])
  })

  it('says so when a failure gives no reason', () => {
    const bare = result({ minute: 0, ok: false, conditions: [] })
    expect(whyText(whyFailed(bare))).toBe('the check gave no reason')
  })
})
