import { createSign, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findUserByEmail } from './auth'
import { clearKeyCache, handleGoogleAuth } from './google'
import { handleAdmin } from './admin'

const CLIENT = 'admin-client.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'a1', alg: 'RS256' }]
const sign = (claims: Record<string, unknown>) => {
  const body = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'a1' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url')
  return body + '.' + createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url')
}
let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rr-admin-google-')); process.env.RR_DATA_DIR = dir
  process.env.RR_GOOGLE_CLIENT_ID = CLIENT; process.env.RR_GOOGLE_CLIENT_SECRET = 'x'
  process.env.RR_ADMIN_GOOGLE_EMAILS = 'Owner.One@gmail.test, owner2@gmail.test'
  delete process.env.RR_ADMIN_PASSWORD_LOGIN
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const ctx = { origin: 'https://ahsantechlabs.com', basePath: '/roundrobin', ip: '203.0.113.9', userAgent: 'vitest', headers: {} }
function fakeRes() {
  const out: { status?: number; headers: Record<string, string | string[]>; body?: string } = { headers: {} }
  return { out, res: { writeHead: (s: number, h: Record<string, string | string[]>) => { out.status = s; out.headers = h }, end: (b?: string) => { out.body = b } } as unknown as ServerResponse }
}
async function google(path: string, cookie = '', fetcher?: typeof fetch) {
  const url = new URL('http://x' + path); const { res, out } = fakeRes()
  await handleGoogleAuth({ method: 'GET', headers: { cookie } } as unknown as IncomingMessage, res, url.pathname.replace('/roundrobin', ''), url, ctx, fetcher)
  return out
}
async function admin(path: string, cookie = '', method = 'GET') {
  const { res, out } = fakeRes()
  const req = Object.assign((async function* () {})(), { method, headers: { cookie, origin: 'https://ahsantechlabs.com' } }) as unknown as IncomingMessage
  await handleAdmin(req, res, path, { origin: 'https://ahsantechlabs.com', ip: '203.0.113.9', basePath: '/roundrobin' })
  return { status: out.status, data: JSON.parse(out.body || '{}') }
}
async function adminSignIn(email: string) {
  clearKeyCache()
  const start = await google('/roundrobin/api/auth/google/start?for=admin')
  const target = new URL(String(start.headers.Location))
  expect(target.searchParams.get('redirect_uri')).toBe('https://ahsantechlabs.com/roundrobin/api/auth/google/callback')
  const state = target.searchParams.get('state')!, nonce = target.searchParams.get('nonce')!
  const now = Math.floor(Date.now() / 1000)
  const fetcher = (async (input: string) => String(input).includes('certs')
    ? new Response(JSON.stringify({ keys }))
    : new Response(JSON.stringify({ id_token: sign({ iss: 'accounts.google.com', aud: CLIENT, sub: 'g-' + email, email, email_verified: true, iat: now, exp: now + 600, nonce }) }))) as unknown as typeof fetch
  return google(`/roundrobin/api/auth/google/callback?code=c&state=${state}`, `rr_google=${state}`, fetcher)
}

describe('admin Google sign-in', () => {
  it('turns password sign-in off by default', async () => {
    expect((await admin('/api/me')).data).toMatchObject({ signedIn: false, google: true, passwordLogin: false })
    expect((await admin('/api/login', '', 'POST')).status).toBe(404)
  })
  it('lets an allowed verified Google account in, with an 8 hour Strict admin cookie', async () => {
    const done = await adminSignIn('owner.one@gmail.test')
    expect(done.headers.Location).toBe('/roundrobin/admin/')
    const cookie = String((done.headers['Set-Cookie'] as string[]).find(c => c.startsWith('rr_admin=')))
    expect(cookie).toMatch(/Path=\/roundrobin\/admin; Secure; SameSite=Strict; HttpOnly; Max-Age=28800/)
    const session = cookie.split(';')[0]
    expect((await admin('/api/me', session)).data).toMatchObject({ signedIn: true, email: 'owner.one@gmail.test' })
    expect((await admin('/api/users', session)).status).toBe(200)
    expect(await findUserByEmail('owner.one@gmail.test')).toBeNull() // admin sign-in never creates an app account
    const audit = (await admin('/api/audit', session)).data.audit
    expect(audit[0]).toMatchObject({ action: 'admin-login', method: 'google', email: 'owner.one@gmail.test' })
    process.env.RR_ADMIN_GOOGLE_EMAILS = 'owner2@gmail.test'
    expect((await admin('/api/users', session)).status).toBe(401) // removed from the list: session ends
    process.env.RR_ADMIN_GOOGLE_EMAILS = 'Owner.One@gmail.test, owner2@gmail.test'
  })
  it('refuses any other Google account with a not-authorised message', async () => {
    const done = await adminSignIn('someone@gmail.test')
    expect(done.headers.Location).toBe('/roundrobin/admin/#error=not_authorised')
    expect(String(done.headers['Set-Cookie'])).not.toContain('rr_admin=')
  })
  it('sends a bad admin callback back to the admin page', async () => {
    const start = await google('/roundrobin/api/auth/google/start?for=admin')
    const state = new URL(String(start.headers.Location)).searchParams.get('state')!
    expect((await google(`/roundrobin/api/auth/google/callback?error=access_denied&state=${state}`, `rr_google=${state}`)).headers.Location).toBe('/roundrobin/admin/#error=cancelled')
  })
})
