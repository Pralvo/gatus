// The server writes the page's UI settings into the page as a JSON data block:
// <script type="application/json" id="page-config">...</script>
// A data block never runs, so the page can forbid inline scripts.

export type SortBy = 'name' | 'group' | 'health'
export type FilterBy = 'none' | 'failing' | 'unstable'

export interface PageLink {
  name: string
  link: string
}

export interface PageConfig {
  header: string
  logo: string
  /** Logo for the dark theme. Empty means the light logo is used on both. */
  logoDark: string
  link: string
  buttons: PageLink[]
  dashboardHeading: string
  dashboardSubheading: string
  maximumNumberOfResults: number
  defaultSortBy: SortBy
  defaultFilterBy: FilterBy
  loginSubtitle: string
  footerLinks: PageLink[]
  sourceLink: string
  /** Whether the feeds plugin serves /feed/atom.xml, /feed/rss.xml and /feed/feed.json. */
  feeds: boolean
}

export const defaultPageConfig: PageConfig = {
  header: 'Gatus',
  logo: '',
  logoDark: '',
  link: '',
  buttons: [],
  dashboardHeading: 'Health Dashboard',
  dashboardSubheading: 'Monitor the health of your endpoints in real-time',
  maximumNumberOfResults: 100,
  defaultSortBy: 'name',
  defaultFilterBy: 'none',
  loginSubtitle: 'System Monitoring Dashboard',
  footerLinks: [],
  sourceLink: 'https://github.com/TwiN/gatus',
  feeds: false,
}

/** Web addresses and paths on this site. Anything else, such as javascript:, is refused. */
export function isPageLink(link: string): boolean {
  return link.startsWith('https://') || link.startsWith('http://') || link.startsWith('/')
}

type Raw = Record<string, unknown>

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

function linkText(value: unknown, fallback: string): string {
  const candidate = text(value, fallback)
  return candidate === '' || isPageLink(candidate) ? candidate : fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback
}

function links(value: unknown): PageLink[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      return []
    }
    const { name, link } = item as Raw
    if (typeof name !== 'string' || name === '' || typeof link !== 'string' || !isPageLink(link)) {
      return []
    }
    return [{ name, link }]
  })
}

function positiveWhole(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Builds a full config from untrusted input, keeping only well-formed values. */
export function parsePageConfig(input: unknown): PageConfig {
  const raw: Raw = typeof input === 'object' && input !== null ? (input as Raw) : {}
  const fallback = defaultPageConfig
  return {
    header: text(raw.header, fallback.header),
    logo: linkText(raw.logo, fallback.logo),
    logoDark: linkText(raw.logoDark, fallback.logoDark),
    link: linkText(raw.link, fallback.link),
    buttons: links(raw.buttons),
    dashboardHeading: text(raw.dashboardHeading, fallback.dashboardHeading),
    dashboardSubheading: text(raw.dashboardSubheading, fallback.dashboardSubheading),
    maximumNumberOfResults: positiveWhole(
      raw.maximumNumberOfResults,
      fallback.maximumNumberOfResults,
    ),
    defaultSortBy: oneOf(raw.defaultSortBy, ['name', 'group', 'health'], fallback.defaultSortBy),
    defaultFilterBy: oneOf(
      raw.defaultFilterBy,
      ['none', 'failing', 'unstable'],
      fallback.defaultFilterBy,
    ),
    loginSubtitle: text(raw.loginSubtitle, fallback.loginSubtitle),
    footerLinks: links(raw.footerLinks),
    sourceLink: linkText(raw.sourceLink, fallback.sourceLink),
    feeds: raw.feeds === true,
  }
}

/** Reads the page's data block. A missing or broken block gives the defaults. */
export function readPageConfig(doc: Document = document): PageConfig {
  const block = doc.getElementById('page-config')
  if (block?.textContent == null || block.textContent.trim() === '') {
    return defaultPageConfig
  }
  try {
    return parsePageConfig(JSON.parse(block.textContent))
  } catch {
    return defaultPageConfig
  }
}
