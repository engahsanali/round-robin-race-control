import { AsyncLocalStorage } from 'node:async_hooks'

export interface CookieInput { name: string; value: string; httpOnly?: boolean; secure?: boolean; path?: string; sameSite?: string; maxAge?: number }
export interface CookieJar {
  get(name: string): string | undefined
  set(input: CookieInput): void
  delete(name: string): void
}

export interface RequestScope { cookies: CookieJar; setCookies: string[]; ip: string; userAgent: string; cookiePath: string }
export const scope = new AsyncLocalStorage<RequestScope>()

export function parseCookies(header: string | undefined) {
  const values = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const name = part.slice(0, index).trim()
    const raw = part.slice(index + 1).trim()
    if (values.has(name)) continue
    try { values.set(name, decodeURIComponent(raw)) } catch { values.set(name, raw) }
  }
  return values
}

export function serializeCookie({ name, value, httpOnly, path = '/', sameSite = 'Lax', maxAge }: CookieInput) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Secure; SameSite=${sameSite}` +
    (httpOnly ? '; HttpOnly' : '') + (maxAge !== undefined ? `; Max-Age=${maxAge}` : '')
}

export function createJar(header: string | undefined, setCookies: string[]): CookieJar {
  const values = parseCookies(header)
  return {
    get: name => values.get(name),
    set: input => { values.set(input.name, input.value); setCookies.push(serializeCookie(input)) },
    delete: name => { values.delete(name); setCookies.push(serializeCookie({ name, value: '', maxAge: 0 })) },
  }
}
