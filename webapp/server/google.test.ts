import { createSign, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUser, findUserByEmail, getUser, sessionUser, SESSION_COOKIE } from './auth'
import { clearKeyCache, handleGoogleAuth, resolveGoogleUser, verifyIdToken, type GoogleClaims } from './google'

const CLIENT = 'test-client.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' } as { kid: string; kty: string; n: string; e: string }
const keys = [jwk]
const now = Math.floor(Date.now() / 1000)
function sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const body = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url')
  return body + '.' + createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url')
}
const good = (extra: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '1001', email: 'Racer@Gmail.test', email_verified: true, name: 'Google Racer', iat: now, exp: now + 3600, nonce: 'n1', ...extra })

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rr-google-')); process.env.RR_DATA_DIR = dir
  process.env.RR_GOOGLE_CLIENT_ID = CLIENT; process.env.RR_GOOGLE_CLIENT_SECRET = 'test-secret'
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('id_token verification', () => {
  const expected = { clientId: CLIENT, nonce: 'n1' }
  it('accepts a valid Google token', () => { expect(verifyIdToken(sign(good()), keys, expected).sub).toBe('1001') })
  it.each([
    ['wrong audience', good({ aud: 'someone-else' })],
    ['wrong issuer', good({ iss: 'https://evil.example' })],
    ['token expired', good({ exp: now - 120 })],
    ['nonce mismatch', good({ nonce: 'other' })],
    ['email not verified by Google', good({ email_verified: false })],
  ])('rejects %s', (reason, claims) => { expect(() => verifyIdToken(sign(claims), keys, expected)).toThrow(reason) })
  it('rejects a forged signature, unknown key and alg none', () => {
    const [h, p] = sign(good()).split('.')
    const forged = h + '.' + Buffer.from(JSON.stringify(good({ sub: '666' }))).toString('base64url') + '.' + sign(good()).split('.')[2]
    expect(() => verifyIdToken(forged, keys, expected)).toThrow('bad signature')
    expect(() => verifyIdToken(sign(good(), { alg: 'RS256', kid: 'nope' }), keys, expected)).toThrow('unknown signing key')
    expect(() => verifyIdToken(`${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`, keys, expected)).toThrow('unexpected algorithm')
    expect(h).toBeTruthy()
  })
})

describe('Google accounts', () => {
  const claims = (sub: string, email: string) => ({ ...good({ sub, email }) }) as GoogleClaims
  it('creates a verified google user, then finds it by Google ID', async () => {
    const first = await resolveGoogleUser(claims('2001', 'new@gmail.test'), '198.51.100.1')
    expect(first.created).toBe(true)
    expect(first.user.signupMethod).toBe('google')
    expect(first.user.verifiedAt).toBeTruthy()
    expect(first.user.passwordHash).toBeNull()
    const again = await resolveGoogleUser(claims('2001', 'new@gmail.test'), '198.51.100.1')
    expect(again.user.id).toBe(first.user.id)
    expect(again.created).toBe(false)
  })
  it('links an existing verified account by email and keeps its password', async () => {
    const user = (await createUser({ email: 'verified@example.test', name: 'V', nickname: '', password: 'a long enough passphrase', method: 'email', verified: true }))!
    const result = await resolveGoogleUser(claims('3001', 'VERIFIED@example.test'), '198.51.100.1')
    expect(result.linked).toBe(true)
    expect(result.user.id).toBe(user.id)
    expect((await getUser(user.id))?.passwordHash).toBeTruthy()
    expect((await getUser(user.id))?.googleSub).toBe('3001')
  })
  it('links an unverified account but removes its password and sessions (pre-hijack guard)', async () => {
    const user = (await createUser({ email: 'squatted@example.test', name: 'S', nickname: '', password: 'attacker chosen passphrase', method: 'email' }))!
    const result = await resolveGoogleUser(claims('4001', 'squatted@example.test'), '198.51.100.1')
    const after = (await getUser(user.id))!
    expect(result.user.id).toBe(user.id)
    expect(after.passwordHash).toBeNull()
    expect(after.sessionEpoch).toBe(user.sessionEpoch + 1)
    expect(after.verifiedAt).toBeTruthy()
  })
})

function fakeReq(url: string, cookie = ''): IncomingMessage { return { method: 'GET', url, headers: { cookie } } as unknown as IncomingMessage }
function fakeRes() {
  const out: { status?: number; headers: Record<string, string | string[]>; body?: string } = { headers: {} }
  const res = { writeHead: (status: number, headers: Record<string, string | string[]>) => { out.status = status; out.headers = headers }, end: (body?: string) => { out.body = body } } as unknown as ServerResponse
  return { res, out }
}
const ctx = { origin: 'https://ahsantechlabs.com', basePath: '/roundrobin', ip: '203.0.113.7', userAgent: 'vitest', headers: {} }
const call = async (path: string, cookie = '', fetcher?: typeof fetch) => {
  const url = new URL('http://x' + path)
  const { res, out } = fakeRes()
  await handleGoogleAuth(fakeReq(path, cookie), res, url.pathname.replace('/roundrobin', ''), url, ctx, fetcher)
  return out
}

describe('OAuth endpoints', () => {
  it('starts with PKCE, state, nonce and the registered redirect URI', async () => {
    const out = await call('/roundrobin/api/auth/google/start')
    expect(out.status).toBe(302)
    const target = new URL(String(out.headers.Location))
    expect(target.origin + target.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(target.searchParams.get('client_id')).toBe(CLIENT)
    expect(target.searchParams.get('redirect_uri')).toBe('https://ahsantechlabs.com/roundrobin/api/auth/google/callback')
    expect(target.searchParams.get('scope')).toBe('openid email profile')
    expect(target.searchParams.get('code_challenge_method')).toBe('S256')
    expect(target.searchParams.get('state')).toBeTruthy()
    expect(String(out.headers['Set-Cookie'])).toMatch(/rr_google=.*HttpOnly/)
  })
  it('rejects a callback with a missing or mismatched state', async () => {
    expect((await call('/roundrobin/api/auth/google/callback?code=x&state=abc')).headers.Location).toBe('/roundrobin/#google_error=state')
    const start = await call('/roundrobin/api/auth/google/start')
    const state = new URL(String(start.headers.Location)).searchParams.get('state')!
    expect((await call(`/roundrobin/api/auth/google/callback?code=x&state=${state}`, 'rr_google=someone-elses')).headers.Location).toBe('/roundrobin/#google_error=state')
  })
  it('completes sign-in once, and refuses a replayed state', async () => {
    clearKeyCache()
    const start = await call('/roundrobin/api/auth/google/start')
    const target = new URL(String(start.headers.Location))
    const state = target.searchParams.get('state')!
    const nonce = target.searchParams.get('nonce')!
    let sentVerifier = ''
    const fetcher = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes('certs')) return new Response(JSON.stringify({ keys }), { headers: { 'cache-control': 'max-age=600' } })
      const form = new URLSearchParams(String(init?.body))
      sentVerifier = form.get('code_verifier') ?? ''
      expect(form.get('redirect_uri')).toBe('https://ahsantechlabs.com/roundrobin/api/auth/google/callback')
      return new Response(JSON.stringify({ id_token: sign(good({ sub: '5001', email: 'flow@gmail.test', nonce })) }))
    }) as typeof fetch
    const done = await call(`/roundrobin/api/auth/google/callback?code=c1&state=${state}`, `rr_google=${state}`, fetcher)
    expect(done.headers.Location).toBe('/roundrobin/')
    expect(sentVerifier.length).toBeGreaterThan(43)
    const session = /rr_session=([^;]+)/.exec(String(done.headers['Set-Cookie']))?.[1]
    expect((await sessionUser(session))?.email).toBe('flow@gmail.test')
    expect((await findUserByEmail('flow@gmail.test'))?.signupMethod).toBe('google')
    expect(String(done.headers['Set-Cookie'])).toContain(SESSION_COOKIE)
    const replay = await call(`/roundrobin/api/auth/google/callback?code=c1&state=${state}`, `rr_google=${state}`, fetcher)
    expect(replay.headers.Location).toBe('/roundrobin/#google_error=state')
  })
})
