import { getStore } from '@netlify/blobs'
import type { Context } from '@netlify/functions'
import { digest, token, validUserId } from './account-security'

export const accounts = getStore({ name: 'race-manager-accounts-v2', consistency: 'strong' })
export interface Session {
  id: string
  email: string
  name?: string
  nickname?: string
}

export interface Profile {
  name: string
  nickname: string
  timezone: string
  entryFee: number
  points?: { first: number; second: number; third: number; version: number }
}

export async function readSession(context: Context): Promise<Session | null> {
  const accessToken = context.cookies.get('nf_jwt')
  if (!accessToken) return null
  // The Identity SDK can return reduced claims on deploy previews. Check the
  // provider's user record for confirmation using the configured site origin.
  const identity = new URL('/.netlify/identity/user', context.site.url)
  if (identity.protocol === 'http:') identity.protocol = 'https:'
  if (identity.protocol !== 'https:') return null
  const response = await fetch(identity, {
    headers: { Authorization: 'Bearer ' + accessToken },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new Error('Identity user lookup failed')
  const user = await response.json()
  if (!validUserId(user.id) || typeof user.email !== 'string' || !user.email || !user.confirmed_at) return null
  const { full_name: name, nickname } = user.user_metadata ?? {}
  return {
    id: user.id,
    email: user.email,
    name: typeof name === 'string' ? name.slice(0, 100) : '',
    nickname: typeof nickname === 'string' ? nickname.slice(0, 60) : '',
  }
}

export function workspace(id: string) {
  if (!validUserId(id)) throw new Error('Invalid workspace')
  return `workspaces/${id}/`
}

export async function profileFor(session: Session) {
  const profile = await accounts.get(workspace(session.id) + 'profile', { type: 'json' }) as Profile | null
  return { ...(profile ?? { name: session.name ?? '', nickname: session.nickname ?? '', timezone: 'Australia/Perth', entryFee: 15 }), id: session.id, email: session.email }
}

export async function recoveryKeyFor(id: string): Promise<string> {
  const path = workspace(id) + 'recovery-key'
  const existing = await accounts.get(path, { type: 'text' })
  if (existing) return existing
  const key = token(32)
  if ((await accounts.set(path, key, { onlyIfNew: true })).modified) return key
  const saved = await accounts.get(path, { type: 'text' })
  if (!saved) throw new Error('Could not store the recovery key')
  return saved
}

export async function allowAuthAttempt(bucket: string, max: number, windowMs = 10 * 60 * 1000) {
  const key = 'limits/' + digest(bucket)
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now()
    const saved = await accounts.getWithMetadata(key, { type: 'json' }) as { data: { until: number; count: number }; etag?: string } | null
    const current = saved && saved.data.until > now ? saved.data : { until: now + windowMs, count: 0 }
    if (current.count >= max) return false
    const options = saved?.etag ? { onlyIfMatch: saved.etag } : { onlyIfNew: true }
    if ((await accounts.setJSON(key, { ...current, count: current.count + 1 }, options)).modified) return true
  }
  return false
}
