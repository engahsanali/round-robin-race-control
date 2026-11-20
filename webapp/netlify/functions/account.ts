import { confirmEmail, login, logout, recoverPassword, requestPasswordRecovery, signup } from '@netlify/identity'
import type { Config, Context } from '@netlify/functions'
import { acceptsPassword, isSameOriginWrite, json, requestBody } from './lib/account-security'
import { accounts, allowAuthAttempt, profileFor, readSession, recoveryKeyFor, workspace } from './lib/account-store'
import type { Profile } from './lib/account-store'
import { claimLegacyEvent, listWorkspaceEvents } from './events'

const passwordHint = 'Use a passphrase with at least 15 characters. Spaces and lowercase words are welcome. Choose a different phrase if it is very common.'
const genericEmail = 'If that address is eligible, an email will arrive shortly.'

const isEmail = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 254 && /^\S+@[^\s@]+\.[^\s@]+$/.test(value)

const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._~-]{12,500}$/.test(value)

const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length <= max

function validTimezone(value: unknown): value is string {
  if (!validText(value, 100)) return false
  try { new Intl.DateTimeFormat('en-AU', { timeZone: value }); return true } catch { return false }
}

function validAmount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
}

export default async (req: Request, context: Context) => {
  try {
    if (req.method === 'GET') {
      const session = await readSession(context)
      if (!session) return json({ account: null, events: [] })
      const [account, events, recoveryKey] = await Promise.all([profileFor(session), listWorkspaceEvents(session.id), recoveryKeyFor(session.id)])
      return json({ account, events, recoveryKey })
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
    if (!isSameOriginWrite(req)) return json({ error: 'This request must come from Race Manager.' }, 403)
    const body = await requestBody(req, 8192)
    if (!body || typeof body !== 'object') return json({ error: 'Invalid account request.' }, 400)
    const { action, email, password, tokenHash } = body

    if (['login', 'signup', 'forgot', 'verify', 'reset'].includes(action)) {
      if (['login', 'signup', 'forgot'].includes(action) && !isEmail(email)) return json({ error: 'Enter a valid email address.' }, 400)
      const rate = action === 'login' ? 20 : 8
      if (!await allowAuthAttempt(`${action}/ip/${context.ip}`, rate) ||
          (isEmail(email) && !await allowAuthAttempt(`${action}/email/${email.toLowerCase()}`, action === 'login' ? 12 : 5))) {
        return json({ error: 'Too many attempts. Please try again in a few minutes.' }, 429)
      }
      if (['signup', 'reset'].includes(action) && !acceptsPassword(password)) return json({ error: passwordHint }, 400)
      if (['verify', 'reset'].includes(action) && !validToken(tokenHash)) return json({ error: 'This email link is invalid or expired.' }, 400)
      if (action === 'signup' && (!validText(body.name, 100) || !body.name.trim() || !validText(body.nickname, 60))) {
        return json({ error: 'Enter a name and an optional nickname.' }, 400)
      }
      if (action === 'login' && !acceptsPassword(password)) return json({ error: 'Sign in failed. Check your details and email verification.' }, 401)

      try {
        if (action === 'signup') {
          await signup(email, password, { full_name: body.name.trim(), nickname: body.nickname.trim() })
          return json({ message: genericEmail })
        }
        if (action === 'forgot') {
          await requestPasswordRecovery(email)
          return json({ message: genericEmail })
        }
        if (action === 'verify') {
          await confirmEmail(tokenHash)
          return json({ message: 'Email verified.' })
        }
        if (action === 'reset') {
          await recoverPassword(tokenHash, password)
          return json({ message: 'Password updated.' })
        }
        await login(email, password)
        return json({ message: 'Signed in.' })
      } catch (error) {
        if (error instanceof Error && error.name === 'MissingIdentityError') return json({ error: 'Account access is temporarily unavailable.' }, 503)
        if (action === 'forgot' || action === 'signup') return json({ message: genericEmail })
        if (action === 'login') return json({ error: 'Sign in failed. Check your details and email verification.' }, 401)
        return json({ error: 'This email link is invalid or expired.' }, 400)
      }
    }

    if (action === 'signout') {
      await logout()
      return json({ account: null })
    }
    const session = await readSession(context)
    if (!session) return json({ error: 'Sign in to continue.' }, 401)
    if (action === 'claim') {
      if (typeof body.link !== 'string' || body.link.length > 1500) return json({ error: 'Enter a private admin link.' }, 400)
      if (!await allowAuthAttempt('claim/' + session.id, 20)) return json({ error: 'Too many attempts. Please try again later.' }, 429)
      const eventId = await claimLegacyEvent(session.id, body.link, new URL(req.url).hostname)
      return eventId ? json({ eventId }) : json({ error: 'This event could not be claimed with that link.' }, 404)
    }
    if (action === 'profile') {
      if (!validText(body.name, 100) || !body.name.trim() || !validText(body.nickname, 60) ||
          !validTimezone(body.timezone) || !validAmount(body.entryFee, 1000)) return json({ error: 'Check your profile settings.' }, 400)
      if (body.points !== undefined && (!body.points || ![body.points.first, body.points.second, body.points.third].every(value => validAmount(value, 10000)))) {
        return json({ error: 'Enter three valid point values.' }, 400)
      }
      const key = workspace(session.id) + 'profile'
      const current = await accounts.getWithMetadata(key, { type: 'json' }) as { data: Profile; etag?: string } | null
      const profile: Profile = { name: body.name.trim(), nickname: body.nickname.trim(), timezone: body.timezone, entryFee: body.entryFee }
      if (body.points) {
        const old = current?.data.points
        const { first, second, third } = body.points
        const same = old && old.first === first && old.second === second && old.third === third
        profile.points = { first, second, third, version: same ? old.version : Date.now() }
      }
      const saved = await accounts.setJSON(key, profile, current?.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true })
      if (!saved.modified) return json({ error: 'Settings changed elsewhere. Reload and try again.' }, 409)
      return json({ account: { ...profile, id: session.id, email: session.email } })
    }
    return json({ error: 'Unsupported account action.' }, 400)
  } catch (error) {
    if (error instanceof RangeError) return json({ error: 'Request too large.' }, 413)
    if (error instanceof SyntaxError) return json({ error: 'Invalid request.' }, 400)
    return json({ error: 'The account service could not complete this request.' }, 503)
  }
}

export const config: Config = { path: '/api/account' }
