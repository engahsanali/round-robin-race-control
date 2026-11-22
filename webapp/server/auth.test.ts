import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { consumeToken, findUserByEmail, getUser, hashPassword, issueToken, sessionUser, SESSION_COOKIE, updateUser, verifyPassword } from './auth'
import { login, logout, recoverPassword, signup } from './identity'
import { createJar, scope } from './runtime'
import { hotp, verifyTotp } from './totp'

let dir = ''
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'rr-auth-')); process.env.RR_DATA_DIR = dir })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

function inRequest<T>(cookieHeader: string, work: () => Promise<T>) {
  const setCookies: string[] = []
  const cookies = createJar(cookieHeader, setCookies)
  return scope.run({ cookies, setCookies, ip: '203.0.113.9', userAgent: 'vitest', cookiePath: '/roundrobin' }, work).then(result => ({ result, setCookies }))
}
const tokenFrom = (cookies: string[]) => /rr_session=([^;]*)/.exec(cookies.find(c => c.startsWith(SESSION_COOKIE + '=')) ?? '')?.[1]

describe('self-hosted accounts', () => {
  it('hashes passwords with scrypt and rejects wrong ones', async () => {
    const hash = await hashPassword('correct passphrase for testing')
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true)
    expect(await verifyPassword('correct passphrase for testing', hash)).toBe(true)
    expect(await verifyPassword('wrong passphrase for testing!', hash)).toBe(false)
    expect(await verifyPassword('anything', null)).toBe(false)
  })

  it('signs up, signs in, signs out and blocks duplicates', async () => {
    const { result, setCookies } = await inRequest('', () => signup('Racer@Example.test', 'a long enough passphrase', { full_name: 'Racer One' }))
    expect(result.signedIn).toBe(true)
    expect(setCookies[0]).toMatch(/HttpOnly/)
    expect(setCookies[0]).toMatch(/Path=\/roundrobin/)
    expect((await inRequest('', () => signup('racer@example.test', 'another long passphrase', {}))).result.signedIn).toBe(false)
    await expect(inRequest('', () => login('racer@example.test', 'not the right passphrase'))).rejects.toThrow()
    const signedIn = await inRequest('', () => login('RACER@example.test', 'a long enough passphrase'))
    const token = tokenFrom(signedIn.setCookies)
    const user = await sessionUser(token)
    expect(user?.email).toBe('Racer@Example.test')
    expect((await getUser(user!.id))?.loginCount).toBe(2)
    await inRequest(`${SESSION_COOKIE}=${token}`, () => logout())
    expect(await sessionUser(token)).toBeNull()
  })

  it('force sign-out, disable and one-time reset tokens', async () => {
    const user = (await findUserByEmail('racer@example.test'))!
    const token = tokenFrom((await inRequest('', () => login('racer@example.test', 'a long enough passphrase'))).setCookies)
    expect(await sessionUser(token)).not.toBeNull()
    await updateUser(user.id, current => ({ ...current, sessionEpoch: current.sessionEpoch + 1 }))
    expect(await sessionUser(token)).toBeNull()
    const reset = await issueToken(user.id, 'reset', 1)
    await inRequest('', () => recoverPassword(reset, 'a brand new passphrase here'))
    expect(await consumeToken(reset, 'reset')).toBeNull()
    await expect(inRequest('', () => recoverPassword(reset, 'reuse should fail here!!'))).rejects.toThrow()
    expect((await inRequest('', () => login('racer@example.test', 'a brand new passphrase here'))).result.email).toBe('Racer@Example.test')
    await updateUser(user.id, current => ({ ...current, disabledAt: new Date().toISOString() }))
    await expect(inRequest('', () => login('racer@example.test', 'a brand new passphrase here'))).rejects.toThrow()
  })

  it('matches the RFC 6238 TOTP vector and refuses replay', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    expect(hotp(secret, 1)).toBe('287082')
    const now = 1_900_000_000_000
    const code = hotp(secret, Math.floor(now / 30_000))
    expect(verifyTotp(secret, code, now)).toBe(true)
    expect(verifyTotp(secret, code, now)).toBe(false)
    expect(verifyTotp(secret, '000000', now + 120_000)).toBe(false)
  })
})
