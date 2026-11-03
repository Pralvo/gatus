// The visitor's theme choice. It lives in the "theme" cookie, which the server
// also reads, so the first paint already has the right colours.

export type ThemeChoice = 'system' | 'light' | 'dark'

const cookieName = 'theme'
const oneYearInSeconds = 60 * 60 * 24 * 365

export function readThemeChoice(cookie: string = document.cookie): ThemeChoice {
  for (const part of cookie.split(';')) {
    const [name, value] = part.trim().split('=')
    if (name === cookieName && (value === 'light' || value === 'dark')) {
      return value
    }
  }
  return 'system'
}

/** Remembers the choice. "system" removes the cookie, so the device decides. */
export function saveThemeChoice(choice: ThemeChoice, doc: Document = document): void {
  const secure = doc.location.protocol === 'https:' ? '; Secure' : ''
  doc.cookie =
    choice === 'system'
      ? `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${cookieName}=${choice}; Path=/; Max-Age=${String(oneYearInSeconds)}; SameSite=Lax${secure}`
}

/** Primer's colour mode for a choice. */
export function colorModeOf(choice: ThemeChoice): 'auto' | 'light' | 'dark' {
  return choice === 'system' ? 'auto' : choice
}
