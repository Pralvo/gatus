// The admin token is kept in this tab's sessionStorage, so it is gone when the
// tab closes, and never in localStorage, a cookie or the address. Storage can
// be blocked; the token then lasts until the page reloads.

export const tokenKey = 'incidents-admin-token'

export function readToken(storage: Storage = sessionStorage): string | null {
  try {
    const value = storage.getItem(tokenKey)
    return value === null || value === '' ? null : value
  } catch {
    return null
  }
}

export function saveToken(token: string, storage: Storage = sessionStorage): void {
  try {
    storage.setItem(tokenKey, token)
  } catch {
    // Memory only.
  }
}

export function forgetToken(storage: Storage = sessionStorage): void {
  try {
    storage.removeItem(tokenKey)
  } catch {
    // Nothing was stored.
  }
}
