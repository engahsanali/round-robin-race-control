import { AsyncLocalStorage } from 'node:async_hooks'

export interface CookieJar {
  get(name: string): string | undefined
  set(input: { name: string; value: string; httpOnly?: boolean; secure?: boolean; path?: string; sameSite?: string; maxAge?: number }): void
  delete(name: string): void
}

export interface RequestScope { cookies: CookieJar; setCookies: string[] }
export const scope = new AsyncLocalStorage<RequestScope>()

export function identityUrl() {
  const site = process.env.RR_IDENTITY_SITE_URL
  if (!site) {
    const error = new Error('Identity is not configured')
    error.name = 'MissingIdentityError'
    throw error
  }
  return new URL('/.netlify/identity', site).href
}

export function parseCookies(header: string | undefined) {
  const values = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const name = part.slice(0, index).trim()
    const raw = part.slice(index + 1).trim()
    try { values.set(name, decodeURIComponent(raw)) } catch { values.set(name, raw) }
  }
  return values
}

export function createJar(header: string | undefined, setCookies: string[]): CookieJar {
  const values = parseCookies(header)
  return {
    get: name => values.get(name),
    set: ({ name, value, httpOnly, path = '/', sameSite = 'Lax', maxAge }) => {
      values.set(name, value)
      setCookies.push(`${name}=${encodeURIComponent(value)}; Path=${path}; Secure; SameSite=${sameSite}` +
        (httpOnly ? '; HttpOnly' : '') + (maxAge !== undefined ? `; Max-Age=${maxAge}` : ''))
    },
    delete: name => {
      values.delete(name)
      setCookies.push(`${name}=; Path=/; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`)
    },
  }
}
