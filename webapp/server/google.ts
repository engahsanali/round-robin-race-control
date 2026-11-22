// Google sign-in for the self-hosted build: OAuth 2.0 authorization code flow
// with PKCE, state bound to the browser by a short-lived cookie, a nonce, and
// full id_token checks (RS256 signature against Google's keys, iss, aud, exp, email_verified).
import { createHash, createPublicKey, randomUUID, timingSafeEqual, verify as verifySignature } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { authStore, createSession, findUserByEmail, getUser, newToken, normalEmail, recordActivity, SESSION_COOKIE, SESSION_DAYS, sha, updateUser, type User } from './auth'
import { parseCookies, serializeCookie } from './runtime'
import { adminGoogleSignIn } from './admin'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const STATE_COOKIE = 'rr_google'
const STATE_MINUTES = 10

export interface GoogleConfig { clientId: string; clientSecret: string }
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.RR_GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.RR_GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export interface GoogleClaims { sub: string; email: string; email_verified: boolean; name?: string; given_name?: string; aud: string; iss: string; exp: number; iat: number; nonce?: string }
interface Jwk { kid: string; kty: string; alg?: string; n: string; e: string }

let keyCache: { keys: Jwk[]; expires: number } | null = null
export async function googleKeys(fetcher: typeof fetch = fetch): Promise<Jwk[]> {
  if (keyCache && keyCache.expires > Date.now()) return keyCache.keys
  const response = await fetcher(CERTS_URL)
  if (!response.ok) throw new Error('Could not load Google signing keys')
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600)
  const { keys } = await response.json() as { keys: Jwk[] }
  keyCache = { keys, expires: Date.now() + Math.min(Math.max(maxAge, 300), 86400) * 1000 }
  return keys
}
export function clearKeyCache() { keyCache = null }

const b64json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

/** Verifies a Google id_token. Throws with a short reason when anything is off. */
export function verifyIdToken(token: string, keys: Jwk[], expected: { clientId: string; nonce: string; now?: number }): GoogleClaims {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed token')
  const header = b64json(parts[0]) as { alg: string; kid: string }
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm')
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA')
  if (!jwk) throw new Error('unknown signing key')
  const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
  if (!verifySignature('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) throw new Error('bad signature')
  const claims = b64json(parts[1]) as GoogleClaims
  const now = Math.floor((expected.now ?? Date.now()) / 1000)
  if (!ISSUERS.has(claims.iss)) throw new Error('wrong issuer')
  if (claims.aud !== expected.clientId) throw new Error('wrong audience')
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new Error('token expired')
  if (typeof claims.iat !== 'number' || claims.iat > now + 300) throw new Error('token issued in the future')
  if (!claims.nonce || !safeEqual(claims.nonce, expected.nonce)) throw new Error('nonce mismatch')
  if (claims.email_verified !== true && (claims.email_verified as unknown) !== 'true') throw new Error('email not verified by Google')
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email.includes('@')) throw new Error('missing identity')
  return { ...claims, email_verified: true }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

const googleIndex = (sub: string) => 'google/' + sha(sub)

/**
 * Finds or creates the Race Manager user for a verified Google identity.
 * - Known Google account: that user.
 * - Same email as an existing account: link it. If that account's email was never
 *   verified, its password is cleared and its sessions revoked, so whoever created it
 *   without owning the mailbox loses access (account pre-hijacking).
 * - Otherwise: a new verified user with sign-up method 'google'.
 */
export async function resolveGoogleUser(claims: GoogleClaims, ip: string): Promise<{ user: User; created: boolean; linked: boolean }> {
  const store = authStore()
  const indexed = await store.get(googleIndex(claims.sub), { type: 'json' }) as { id: string } | null
  if (indexed) {
    const user = await getUser(indexed.id)
    if (user) return { user, created: false, linked: false }
    await store.delete(googleIndex(claims.sub))
  }
  const email = claims.email.trim()
  const existing = await findUserByEmail(email)
  if (existing) {
    const wasVerified = Boolean(existing.verifiedAt)
    const user = await updateUser(existing.id, current => ({
      ...current, googleSub: claims.sub, verifiedAt: current.verifiedAt ?? new Date().toISOString(),
      ...(wasVerified ? {} : { passwordHash: null, sessionEpoch: current.sessionEpoch + 1 }),
    }))
    await store.setJSON(googleIndex(claims.sub), { id: existing.id })
    await recordActivity(existing.id, { type: 'google-linked', ip, detail: wasVerified ? 'linked by verified email' : 'linked; unverified password removed' })
    return { user: user ?? existing, created: false, linked: true }
  }
  const id = randomUUID()
  const claim = await store.setJSON('email/' + sha(normalEmail(email)), { id }, { onlyIfNew: true })
  if (!claim.modified) return resolveGoogleUser(claims, ip) // lost a race with a parallel sign-up; link instead
  const now = new Date().toISOString()
  const user: User = {
    id, workspaceId: id, email, name: (claims.name ?? claims.given_name ?? '').slice(0, 100), nickname: '', passwordHash: null,
    signupMethod: 'google', createdAt: now, verifiedAt: now, disabledAt: null, lastLoginAt: null, lastSeenAt: null,
    loginCount: 0, sessionEpoch: 0, signupIp: ip, googleSub: claims.sub,
  }
  await store.setJSON('users/' + id, user, { onlyIfNew: true })
  await store.setJSON(googleIndex(claims.sub), { id })
  await recordActivity(id, { type: 'signup', ip, detail: 'google' })
  return { user, created: true, linked: false }
}

export async function forgetGoogle(user: User) {
  if (user.googleSub) await authStore().delete(googleIndex(user.googleSub))
}

// ---- HTTP ----

const attempts = new Map<string, number[]>()
function allow(ip: string, limit = 30) {
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter(at => now - at < 15 * 60_000)
  recent.push(now)
  attempts.set(ip, recent)
  if (attempts.size > 5000) attempts.clear()
  return recent.length <= limit
}

interface Ctx { origin: string; basePath: string; ip: string; userAgent: string; headers: Record<string, string> }
const redirectUri = (ctx: Ctx) => process.env.RR_GOOGLE_REDIRECT_URI || `${ctx.origin}${ctx.basePath}/api/auth/google/callback`

function redirect(res: ServerResponse, ctx: Ctx, location: string, cookies: string[] = []) {
  res.writeHead(302, { ...ctx.headers, Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) })
  res.end()
}
const fail = (res: ServerResponse, ctx: Ctx, reason: string, cookies: string[] = []) =>
  redirect(res, ctx, `${ctx.basePath}/#google_error=${encodeURIComponent(reason)}`, cookies)

export async function handleGoogleAuth(req: IncomingMessage, res: ServerResponse, path: string, url: URL, ctx: Ctx, fetcher: typeof fetch = fetch) {
  const config = googleConfig()
  const json = (status: number, body: unknown) => { res.writeHead(status, { ...ctx.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  if (path === '/api/auth/config') return json(200, { google: Boolean(config) })
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' })
  const cookiePath = `${ctx.basePath}/api/auth/google`
  const clearState = serializeCookie({ name: STATE_COOKIE, value: '', httpOnly: true, path: cookiePath, sameSite: 'Lax', maxAge: 0 })

  if (path === '/api/auth/google/start') {
    if (!config) return fail(res, ctx, 'unavailable')
    if (!allow(ctx.ip)) return fail(res, ctx, 'busy')
    const purpose = url.searchParams.get('for') === 'admin' ? 'admin' : 'app'
    const state = newToken(), verifier = newToken(48), nonce = newToken()
    await authStore().setJSON('oauth/' + sha(state), { purpose, verifier, nonce, expiresAt: new Date(Date.now() + STATE_MINUTES * 60_000).toISOString(), used: false })
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const target = new URL(AUTH_URL)
    target.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: redirectUri(ctx), response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    }).toString()
    return redirect(res, ctx, target.toString(), [serializeCookie({ name: STATE_COOKIE, value: state, httpOnly: true, path: cookiePath, sameSite: 'Lax', maxAge: STATE_MINUTES * 60 })])
  }

  if (path === '/api/auth/google/callback') {
    if (!config) return fail(res, ctx, 'unavailable', [clearState])
    if (!allow(ctx.ip, 60)) return fail(res, ctx, 'busy', [clearState])
    const state = url.searchParams.get('state') ?? ''
    const cookieState = parseCookies(req.headers.cookie).get(STATE_COOKIE) ?? ''
    if (!state || !cookieState || !safeEqual(state, cookieState)) return fail(res, ctx, 'state', [clearState])
    const store = authStore()
    const key = 'oauth/' + sha(state)
    const pending = await store.getWithMetadata(key, { type: 'json' }) as { data: { purpose?: 'app' | 'admin'; verifier: string; nonce: string; expiresAt: string; used: boolean }; etag: string } | null
    if (!pending || pending.data.used || Date.parse(pending.data.expiresAt) < Date.now()) return fail(res, ctx, 'state', [clearState])
    if (!(await store.setJSON(key, { ...pending.data, used: true }, { onlyIfMatch: pending.etag })).modified) return fail(res, ctx, 'state', [clearState])
    const admin = pending.data.purpose === 'admin'
    const back = (reason: string) => admin ? redirect(res, ctx, `${ctx.basePath}/admin/#error=${encodeURIComponent(reason)}`, [clearState]) : fail(res, ctx, reason, [clearState])
    if (url.searchParams.get('error')) return back('cancelled')
    const code = url.searchParams.get('code')
    if (!code) return back('failed')
    let claims: GoogleClaims
    try {
      const token = await fetcher(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri(ctx), grant_type: 'authorization_code', code_verifier: pending.data.verifier }),
      })
      const body = await token.json() as { id_token?: string; error?: string }
      if (!token.ok || !body.id_token) throw new Error('token exchange failed: ' + (body.error ?? token.status))
      claims = verifyIdToken(body.id_token, await googleKeys(fetcher), { clientId: config.clientId, nonce: pending.data.nonce })
    } catch (error) {
      console.error('google sign-in rejected:', error instanceof Error ? error.message : error)
      return back('failed')
    }
    if (admin) {
      const result = await adminGoogleSignIn(claims.email, { origin: ctx.origin, ip: ctx.ip, basePath: ctx.basePath })
      if ('error' in result) return back(result.error)
      return redirect(res, ctx, `${ctx.basePath}/admin/`, [clearState, result.cookie])
    }
    const { user } = await resolveGoogleUser(claims, ctx.ip)
    if (user.disabledAt) { await recordActivity(user.id, { type: 'login-blocked', ip: ctx.ip, detail: 'google' }); return fail(res, ctx, 'disabled', [clearState]) }
    const fresh = (await getUser(user.id)) ?? user
    const session = await createSession(fresh, ctx.ip, ctx.userAgent)
    await updateUser(user.id, current => ({ ...current, lastLoginAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), loginCount: current.loginCount + 1 }))
    await recordActivity(user.id, { type: 'login', ip: ctx.ip, detail: 'google' })
    return redirect(res, ctx, `${ctx.basePath}/`, [clearState, serializeCookie({ name: SESSION_COOKIE, value: session, httpOnly: true, path: ctx.basePath || '/', sameSite: 'Lax', maxAge: SESSION_DAYS * 86400 })])
  }
  return json(404, { error: 'Not found' })
}
