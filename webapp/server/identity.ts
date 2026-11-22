// Server-side stand-in for the parts of @netlify/identity used by
// netlify/functions/account.ts, backed by the self-hosted accounts in auth.ts.
import { consumeToken, createSession, createUser, endSession, findUserByEmail, hashPassword, issueToken, recordActivity, SESSION_COOKIE, SESSION_DAYS, updateUser, verifyPassword } from './auth'
import { scope } from './runtime'
import { emailAccountLink, mailConfigured } from './mail'

class AuthError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'AuthError' }
}

function request() {
  const current = scope.getStore()
  if (!current) throw new AuthError('Server-side auth requires a request scope')
  return current
}

function setSessionCookie(token: string) {
  request().cookies.set({ name: SESSION_COOKIE, value: token, httpOnly: true, secure: true, path: request().cookiePath, sameSite: 'Lax', maxAge: SESSION_DAYS * 86400 })
}

export async function login(email: string, password: string) {
  const { ip, userAgent } = request()
  const user = await findUserByEmail(email)
  const ok = await verifyPassword(password, user?.passwordHash ?? null)
  if (!user || !ok || user.disabledAt) {
    if (user) await recordActivity(user.id, { type: user.disabledAt ? 'login-blocked' : 'login-failed', ip })
    throw new AuthError('Invalid login', 401)
  }
  if (process.env.RR_REQUIRE_VERIFIED === '1' && !user.verifiedAt) throw new AuthError('Email not verified', 401)
  const token = await createSession(user, ip, userAgent)
  await updateUser(user.id, current => ({ ...current, lastLoginAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), loginCount: current.loginCount + 1 }))
  await recordActivity(user.id, { type: 'login', ip })
  setSessionCookie(token)
  return user
}

/** Without an email sender, new accounts are signed in straight away and verified later by the admin. */
export async function signup(email: string, password: string, data: { full_name?: string; nickname?: string }) {
  const { ip, userAgent } = request()
  const user = await createUser({ email, password, name: data.full_name ?? '', nickname: data.nickname ?? '', method: 'email', ip })
  if (!user) return { signedIn: false }
  setSessionCookie(await createSession(user, ip, userAgent))
  await updateUser(user.id, current => ({ ...current, lastLoginAt: new Date().toISOString(), loginCount: 1 }))
  const sent = await emailAccountLink('verify', user, ip)
  return { signedIn: true, message: sent ? 'Account created. You are signed in. We sent you an email to confirm your address.' : 'Account created. You are signed in.' }
}

export async function requestPasswordRecovery(email: string) {
  const { ip } = request()
  const user = await findUserByEmail(email)
  if (!mailConfigured()) {
    if (user) await recordActivity(user.id, { type: 'reset-requested', ip })
    return 'Your request has been passed to the Race Manager admin, who will send you a reset link.'
  }
  // Same answer whether or not the account exists. A failed send is flagged for the admin.
  if (user && !user.disabledAt) await emailAccountLink('reset', user, ip)
  else if (user) await recordActivity(user.id, { type: 'reset-blocked', ip })
  return 'If that address has an account, a reset link is on its way. It works once and expires in 1 hour. If it does not arrive, contact@ahsantechlabs.com can help.'
}

export async function confirmEmail(token: string) {
  const userId = await consumeToken(token, 'verify')
  if (!userId) throw new AuthError('Invalid token', 400)
  await updateUser(userId, user => ({ ...user, verifiedAt: user.verifiedAt ?? new Date().toISOString() }))
  await recordActivity(userId, { type: 'email-verified', ip: request().ip })
}

export async function recoverPassword(token: string, password: string) {
  const userId = await consumeToken(token, 'reset')
  if (!userId) throw new AuthError('Invalid token', 400)
  const passwordHash = await hashPassword(password)
  // A reset link proves the person controls the link the admin sent, so it also verifies the email.
  await updateUser(userId, user => ({ ...user, passwordHash, sessionEpoch: user.sessionEpoch + 1, verifiedAt: user.verifiedAt ?? new Date().toISOString() }))
  await recordActivity(userId, { type: 'password-reset', ip: request().ip })
}

export async function logout() {
  const current = request()
  await endSession(current.cookies.get(SESSION_COOKIE))
  current.cookies.set({ name: SESSION_COOKIE, value: '', httpOnly: true, secure: true, path: current.cookiePath, sameSite: 'Lax', maxAge: 0 })
}

export { issueToken }
