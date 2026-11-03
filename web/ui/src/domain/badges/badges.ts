// "Embed a badge" (spec 4.2 item 9): the addresses of Gatus's badge images for
// one service, absolute, so they work when pasted into another site.

export interface BadgeLink {
  /** "Health", "Uptime, 7 days", "Response time, 24 hours" */
  label: string
  url: string
}

/** The three badge addresses for a service on this site. */
export function badgeLinks(origin: string, key: string): BadgeLink[] {
  const base = `${origin.replace(/\/+$/, '')}/api/v1/endpoints/${encodeURIComponent(key)}`
  return [
    { label: 'Health', url: `${base}/health/badge.svg` },
    { label: 'Uptime, 7 days', url: `${base}/uptimes/7d/badge.svg` },
    { label: 'Response time, 24 hours', url: `${base}/response-times/24h/badge.svg` },
  ]
}
