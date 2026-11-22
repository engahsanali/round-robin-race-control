// Server-side replacement for the parts of @netlify/identity that the
// account function uses. It talks to the existing Netlify Identity (GoTrue)
// instance over HTTPS, so existing accounts and passwords keep working.
import { identityUrl, scope } from './runtime'

class AuthError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'AuthError' }
}

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(identityUrl() + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new AuthError(body.msg ?? body.error_description ?? `Identity request failed (${response.status})`, response.status)
  return body
}

const jsonInit = (body: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body),
})

function cookies() {
  const current = scope.getStore()
  if (!current) throw new AuthError('Server-side auth requires a request scope')
  return current.cookies
}

function setAuthCookies(accessToken: string, refreshToken?: string) {
  const jar = cookies()
  jar.set({ name: 'nf_jwt', value: accessToken, httpOnly: false, secure: true, path: '/', sameSite: 'Lax' })
  if (refreshToken) jar.set({ name: 'nf_refresh', value: refreshToken, httpOnly: false, secure: true, path: '/', sameSite: 'Lax' })
}

export async function login(email: string, password: string) {
  const tokens = await call('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', username: email, password }).toString(),
  })
  const user = await call('/user', { headers: { Authorization: 'Bearer ' + tokens.access_token } })
  setAuthCookies(tokens.access_token, tokens.refresh_token)
  return user
}

export async function signup(email: string, password: string, data: Record<string, unknown>) {
  const user = await call('/signup', jsonInit({ email, password, data }))
  if (user.confirmed_at && user.access_token) setAuthCookies(user.access_token, user.refresh_token)
  return user
}

export async function requestPasswordRecovery(email: string) {
  await call('/recover', jsonInit({ email }))
}

export async function confirmEmail(token: string) {
  return call('/verify', jsonInit({ token, type: 'signup' }))
}

export async function recoverPassword(token: string, password: string) {
  const session = await call('/verify', jsonInit({ token, type: 'recovery' }))
  return call('/user', { ...jsonInit({ password }, session.access_token), method: 'PUT' })
}

export async function logout() {
  const jar = cookies()
  const jwt = jar.get('nf_jwt')
  if (jwt) await fetch(identityUrl() + '/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt }, signal: AbortSignal.timeout(5000) }).catch(() => undefined)
  jar.delete('nf_jwt')
  jar.delete('nf_refresh')
}
