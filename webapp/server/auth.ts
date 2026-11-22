// Self-hosted accounts for Race Manager: users, password hashes, sessions,
// one-time tokens and activity, kept in the file blob store.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { getStore } from './blobs'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }
export const SESSION_DAYS = 30
export const SESSION_COOKIE = 'rr_session'

export const authStore = () => getStore({ name: 'race-manager-auth' })
export const sha = (value: string) => createHash('sha256').update(value).digest('hex')
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const normalEmail = (email: string) => email.trim().toLowerCase()

export interface User {
  id: string
  workspaceId: string
  email: string
  name: string
  nickname: string
  passwordHash: string | null
  signupMethod: 'email' | 'admin' | 'legacy' | 'google'
  googleSub?: string
  createdAt: string
  verifiedAt: string | null
  disabledAt: string | null
  lastLoginAt: string | null
  lastSeenAt: string | null
  loginCount: number
  sessionEpoch: number
  signupIp?: string
  note?: string
}
export interface SessionRecord { userId: string; epoch: number; createdAt: string; expiresAt: string; ip: string; userAgent: string }
export interface Activity { at: string; type: string; ip?: string; detail?: string }

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password.normalize('NFKC'), salt, 64, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

const dummyHash = hashPassword(newToken())
export async function verifyPassword(password: string, stored: string | null) {
  const encoded = stored ?? await dummyHash
  const [scheme, n, r, p, salt, hash] = encoded.split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem })
  return Boolean(stored) && timingSafeEqual(actual, expected)
}

export async function getUser(id: string) {
  return await authStore().get('users/' + id, { type: 'json' }) as User | null
}

export async function findUserByEmail(email: string) {
  const index = await authStore().get('email/' + sha(normalEmail(email)), { type: 'json' }) as { id: string } | null
  return index ? getUser(index.id) : null
}

export async function listUsers() {
  const store = authStore()
  const { blobs } = await store.list({ prefix: 'users/' })
  const users = await Promise.all(blobs.map(blob => store.get(blob.key, { type: 'json' }) as Promise<User | null>))
  return users.filter((user): user is User => Boolean(user))
}

/** Read-modify-write a user with an ETag check so concurrent updates never clobber each other. */
export async function updateUser(id: string, change: (user: User) => User | null) {
  const store = authStore()
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await store.getWithMetadata('users/' + id, { type: 'json' }) as { data: User; etag: string } | null
    if (!current) return null
    const next = change(structuredClone(current.data))
    if (!next) return current.data
    if ((await store.setJSON('users/' + id, next, { onlyIfMatch: current.etag })).modified) return next
  }
  throw new Error('User changed too often; try again')
}

export async function createUser(input: { email: string; name: string; nickname: string; password: string | null; method: User['signupMethod']; ip?: string; workspaceId?: string; verified?: boolean }) {
  const store = authStore()
  const emailKey = 'email/' + sha(normalEmail(input.email))
  const id = randomUUID()
  const claim = await store.setJSON(emailKey, { id }, { onlyIfNew: true })
  if (!claim.modified) return null
  const now = new Date().toISOString()
  const user: User = {
    id, workspaceId: input.workspaceId ?? id, email: input.email.trim(), name: input.name, nickname: input.nickname,
    passwordHash: input.password ? await hashPassword(input.password) : null, signupMethod: input.method, createdAt: now,
    verifiedAt: input.verified ? now : null, disabledAt: null, lastLoginAt: null, lastSeenAt: null, loginCount: 0, sessionEpoch: 0, signupIp: input.ip,
  }
  await store.setJSON('users/' + id, user, { onlyIfNew: true })
  await recordActivity(id, { type: 'signup', ip: input.ip, detail: input.method })
  return user
}

export async function deleteUser(id: string) {
  const user = await getUser(id)
  if (!user) return false
  const store = authStore()
  // Keep a tombstone without the password hash; race data in the workspace is not touched.
  await store.setJSON('deleted/' + id, { ...user, passwordHash: null, deletedAt: new Date().toISOString() })
  await store.delete('email/' + sha(normalEmail(user.email)))
  if (user.googleSub) await store.delete('google/' + sha(user.googleSub))
  await store.delete('users/' + id)
  return true
}

export async function recordActivity(userId: string, item: Omit<Activity, 'at'>) {
  const store = authStore()
  const key = 'activity/' + userId
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.getWithMetadata(key, { type: 'json' }) as { data: Activity[]; etag: string } | null
    const next = [{ at: new Date().toISOString(), ...item }, ...(current?.data ?? [])].slice(0, 100)
    if ((await store.setJSON(key, next, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true })).modified) return
  }
}

export async function activityFor(userId: string) {
  return (await authStore().get('activity/' + userId, { type: 'json' }) as Activity[] | null) ?? []
}

export async function createSession(user: User, ip: string, userAgent: string) {
  const token = newToken()
  const now = Date.now()
  const record: SessionRecord = {
    userId: user.id, epoch: user.sessionEpoch, createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * 86400_000).toISOString(), ip, userAgent: userAgent.slice(0, 200),
  }
  await authStore().setJSON('sessions/' + sha(token), record)
  return token
}

export async function sessionUser(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
  const store = authStore()
  const session = await store.get('sessions/' + sha(token), { type: 'json' }) as SessionRecord | null
  if (!session || Date.parse(session.expiresAt) < Date.now()) return null
  const user = await getUser(session.userId)
  if (!user || user.disabledAt || user.sessionEpoch !== session.epoch) return null
  if (process.env.RR_REQUIRE_VERIFIED === '1' && !user.verifiedAt) return null
  if (!user.lastSeenAt || Date.now() - Date.parse(user.lastSeenAt) > 5 * 60_000) {
    void updateUser(user.id, current => ({ ...current, lastSeenAt: new Date().toISOString() })).catch(() => undefined)
  }
  return user
}

export async function endSession(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return
  const store = authStore()
  const key = 'sessions/' + sha(token)
  const session = await store.get(key, { type: 'json' }) as SessionRecord | null
  if (session) await store.setJSON(key, { ...session, expiresAt: new Date(0).toISOString() })
}

export async function issueToken(userId: string, type: 'verify' | 'reset', hours: number) {
  const token = newToken()
  await authStore().setJSON('tokens/' + sha(token), { userId, type, expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(), used: false })
  return token
}

export async function consumeToken(token: string, type: 'verify' | 'reset') {
  const store = authStore()
  const key = 'tokens/' + sha(token)
  const current = await store.getWithMetadata(key, { type: 'json' }) as { data: { userId: string; type: string; expiresAt: string; used: boolean }; etag: string } | null
  if (!current || current.data.used || current.data.type !== type || Date.parse(current.data.expiresAt) < Date.now()) return null
  const used = await store.setJSON(key, { ...current.data, used: true, usedAt: new Date().toISOString() }, { onlyIfMatch: current.etag })
  return used.modified ? current.data.userId : null
}
