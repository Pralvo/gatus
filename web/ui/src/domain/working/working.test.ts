import { describe, expect, it } from 'vitest'

import { workingMeaning } from './working'

describe('workingMeaning', () => {
  it.each([
    [
      ['[STATUS] == 200', '[RESPONSE_TIME] < 5000', '[CERTIFICATE_EXPIRATION] > 168h'],
      'It answers with success (200) within 5 seconds, and its security certificate is valid for more than 7 days.',
    ],
    [['[STATUS] == 200'], 'It answers with success (200).'],
    [['[STATUS] == 204'], 'It answers with 204 (success, no content).'],
    [['[STATUS] < 500'], 'It answers without a server error (any code below 500).'],
    [['[STATUS] < 400'], 'It answers without an error (any code below 400).'],
    [['[STATUS] == 201'], 'It answers with 201 (success).'],
    [['[STATUS] == 301'], 'It answers with 301.'],
    [
      ['[STATUS] >= 200', '[RESPONSE_TIME] <= 300'],
      'It answers with a code of 200 or above within 300 milliseconds.',
    ],
    [['[RESPONSE_TIME] < 1500'], 'It answers within 1.5 seconds.'],
    [['[RESPONSE_TIME] < 1000'], 'It answers within 1 second.'],
    [['[CONNECTED] == true'], 'It can be reached.'],
    [
      ['[CERTIFICATE_EXPIRATION] >= 36h'],
      'Its security certificate is valid for at least 36 hours.',
    ],
    [
      ['[STATUS] == 200', '[DOMAIN_EXPIRATION] > 720h', '[CERTIFICATE_EXPIRATION] > 24h'],
      'It answers with success (200), its domain registration is valid for more than 30 days, and its security certificate is valid for more than 1 day.',
    ],
  ])('describes %j', (conditions, sentence) => {
    expect(workingMeaning(conditions)).toEqual({ sentence, unrecognised: [] })
  })

  it('keeps unknown conditions as written, beside the sentence', () => {
    expect(workingMeaning(['[STATUS] == 200', '[BODY].status == UP', '[STATUS] == 204'])).toEqual({
      sentence: 'It answers with success (200).',
      unrecognised: ['[BODY].status == UP', '[STATUS] == 204'],
    })
  })

  it('gives no sentence when nothing is readable', () => {
    expect(workingMeaning(['[DNS_RCODE] == NOERROR', '[STATUS] == any(200, 201)'])).toEqual({
      sentence: null,
      unrecognised: ['[DNS_RCODE] == NOERROR', '[STATUS] == any(200, 201)'],
    })
  })

  it('gives nothing for a check with no conditions', () => {
    expect(workingMeaning([])).toEqual({ sentence: null, unrecognised: [] })
  })

  it('reads the conditions as written even when they carry seen values', () => {
    expect(workingMeaning(['[STATUS] (503) < 500']).sentence).toBe(
      'It answers without a server error (any code below 500).',
    )
  })
})
