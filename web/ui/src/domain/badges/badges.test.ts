import { describe, expect, it } from 'vitest'

import { badgeLinks } from './badges'

describe('badgeLinks', () => {
  it('builds absolute badge addresses for a service', () => {
    expect(badgeLinks('https://status.pralvo.com', 'supporting-services_media')).toEqual([
      {
        label: 'Health',
        url: 'https://status.pralvo.com/api/v1/endpoints/supporting-services_media/health/badge.svg',
      },
      {
        label: 'Uptime, 7 days',
        url: 'https://status.pralvo.com/api/v1/endpoints/supporting-services_media/uptimes/7d/badge.svg',
      },
      {
        label: 'Response time, 24 hours',
        url: 'https://status.pralvo.com/api/v1/endpoints/supporting-services_media/response-times/24h/badge.svg',
      },
    ])
  })

  it('escapes the key and drops a trailing slash from the origin', () => {
    const [health] = badgeLinks('http://localhost:8081/', 'a/b?c=<x>')
    expect(health?.url).toBe(
      'http://localhost:8081/api/v1/endpoints/a%2Fb%3Fc%3D%3Cx%3E/health/badge.svg',
    )
  })
})
