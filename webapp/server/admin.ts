// Private admin dashboard API at <base>/admin. One admin account, configured in
// a read-only secrets file (RR_ADMIN_FILE) holding the email, scrypt hash and TOTP secret.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { getStore } from './blobs'
import {
  activityFor, authStore, createUser, deleteUser, findUserByEmail, getUser, hashPassword, issueToken, listUsers,
  newToken, normalEmail, recordActivity, sha, updateUser, verifyPassword,
} from './auth'
import type { User } from './auth'
import { parseCookies, serializeCookie } from './runtime'
import { verifyTotp } from './totp'
import { emailAccountLink } from './mail'
import adminHtml from './admin/index.html?raw'
import adminJs from './admin/admin.js?raw'
import adminCss from './admin/admin.css?raw'

interface AdminConfig { email: string; passwordHash: string; totpSecret?: string }
interface AdminContext { origin: string; ip: string; basePath: string }
const ADMIN_COOKIE = 'rr_admin'
const ADMIN_HOURS = 8
const accounts = () => getStore({ name: 'race-manager-accounts-v2' })

async function adminConfig(): Promise<AdminConfig | null> {
  const file = process.env.RR_ADMIN_FILE
  if (!file) return null
  try {
    const config = JSON.parse(await readFile(file, 'utf8'))
    return typeof config.email === 'string' && typeof config.passwordHash === 'string' ? config : null
  } catch { return null }
}

const attempts = new Map<string, number[]>()
function allow(ip: string) {
  const now = Date.now()
  const recent = [...(attempts.get(ip) ?? []), ...(attempts.get('*') ?? [])].filter(at => now - at < 15 * 60_000)
  const mine = (attempts.get(ip) ?? []).filter(at => now - at < 15 * 60_000)
  if (mine.length >= 5 || recent.length - mine.length >= 30) return false
  attempts.set(ip, [...mine, now])
  attempts.set('*', [...(attempts.get('*') ?? []).filter(at => now - at < 15 * 60_000), now])
  return true
}

const security = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...security, ...headers })
  res.end(JSON.stringify(body))
}

async function body(req: IncomingMessage) {
  let text = ''
  for await (const chunk of req) { text += chunk; if (text.length > 16_384) throw new RangeError('Too large') }
  return text ? JSON.parse(text) : {}
}

async function audit(action: string, ctx: AdminContext, detail: Record<string, unknown> = {}) {
  const store = authStore()
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.getWithMetadata('admin/audit', { type: 'json' }) as { data: unknown[]; etag: string } | null
    const next = [{ id: randomUUID(), at: new Date().toISOString(), action, ip: ctx.ip, ...detail }, ...(current?.data ?? [])].slice(0, 2000)
    if ((await store.setJSON('admin/audit', next, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true })).modified) return
  }
}

async function adminSession(req: IncomingMessage) {
  const token = parseCookies(req.headers.cookie).get(ADMIN_COOKIE)
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
  const session = await authStore().get('admin-sessions/' + sha(token), { type: 'json' }) as { expiresAt: string; email: string } | null
  return session && Date.parse(session.expiresAt) > Date.now() ? { token, ...session } : null
}

interface EventStats { id: string; name: string; date: string; venue: string; status: string; updatedAt: string; brackets: number; entrants: number; races: number; heatsRun: number }
type Group = { id: string; entrants?: { name?: string }[]; heats?: { winnerId?: string | null }[] }
type EventDoc = { id: string; name: string; date: string; venue: string; status: string; updatedAt: string; createdAt?: string; mainClasses: { groups: Group[] }[]; finalsClasses: { groups: Group[] }[]; reraces: Group[] }

async function workspaceStats(workspaceId: string) {
  const store = accounts()
  const prefix = `workspaces/${workspaceId}/`
  const { blobs } = await store.list({ prefix })
  const events: EventStats[] = []
  for (const blob of blobs.filter(item => item.key.startsWith(prefix + 'event/'))) {
    const event = await store.get(blob.key, { type: 'json' }) as EventDoc | null
    if (!event) continue
    const groups = new Map<string, Group>()
    for (const group of [...event.mainClasses.flatMap(c => c.groups), ...event.finalsClasses.flatMap(c => c.groups), ...event.reraces]) groups.set(group.id, group)
    for (const item of blobs.filter(entry => entry.key.startsWith(`${prefix}group/${event.id}/`))) {
      const record = await store.get(item.key, { type: 'json' }) as { group?: Group; updatedAt?: string } | null
      if (record?.group && groups.has(record.group.id)) groups.set(record.group.id, record.group)
      if (record?.updatedAt && record.updatedAt > event.updatedAt) event.updatedAt = record.updatedAt
    }
    const used = [...groups.values()].filter(group => (group.entrants ?? []).some(entry => entry.name))
    const heats = used.flatMap(group => group.heats ?? [])
    events.push({
      id: event.id, name: event.name, date: event.date, venue: event.venue, status: event.status, updatedAt: event.updatedAt,
      brackets: used.length, entrants: used.reduce((sum, group) => sum + (group.entrants ?? []).filter(entry => entry.name).length, 0),
      races: heats.length, heatsRun: heats.filter(heat => heat.winnerId).length,
    })
  }
  events.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const podiums = blobs.filter(item => item.key.startsWith(prefix + 'podiums/')).length
  const published = blobs.filter(item => item.key.startsWith(prefix + 'publication/')).length
  return {
    events, podiums, published,
    totals: {
      events: events.length, brackets: events.reduce((s, e) => s + e.brackets, 0),
      heatsRun: events.reduce((s, e) => s + e.heatsRun, 0), lastEventUpdate: events[0]?.updatedAt ?? null,
    },
  }
}

const publicUser = (user: User) => {
  const { passwordHash, ...rest } = user
  return { ...rest, hasPassword: Boolean(passwordHash) }
}

async function allWorkspaces() {
  const { blobs } = await accounts().list({ prefix: 'workspaces/' })
  return [...new Set(blobs.map(blob => blob.key.split('/')[1]))]
}

export async function handleAdmin(req: IncomingMessage, res: ServerResponse, path: string, ctx: AdminContext) {
  const method = req.method ?? 'GET'
  if (path === '' || path === '/') {
    if (!path) { res.writeHead(301, { Location: ctx.basePath + '/admin/', ...security }); return res.end() }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...security }); return res.end(adminHtml)
  }
  if (path === '/admin.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', ...security }); return res.end(adminJs) }
  if (path === '/admin.css') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', ...security }); return res.end(adminCss) }
  if (!path.startsWith('/api/')) return send(res, 404, { error: 'Not found' })
  if (method !== 'GET' && (req.headers.origin !== ctx.origin || req.headers['sec-fetch-site'] === 'cross-site')) return send(res, 403, { error: 'Bad origin' })
  const config = await adminConfig()
  if (!config) return send(res, 503, { error: 'Admin is not configured.' })
  const cookiePath = ctx.basePath + '/admin'
  const route = path.slice(4)

  if (route === '/login' && method === 'POST') {
    if (!allow(ctx.ip)) return send(res, 429, { error: 'Too many attempts. Wait 15 minutes.' })
    const input = await body(req)
    const emailOk = typeof input.email === 'string' && normalEmail(input.email) === normalEmail(config.email)
    const passwordOk = typeof input.password === 'string' && await verifyPassword(input.password, config.passwordHash)
    const codeOk = !config.totpSecret || (typeof input.code === 'string' && verifyTotp(config.totpSecret, input.code.trim()))
    if (!emailOk || !passwordOk || !codeOk) { await audit('admin-login-failed', ctx); return send(res, 401, { error: 'Sign in failed.' }) }
    const token = newToken()
    await authStore().setJSON('admin-sessions/' + sha(token), { email: config.email, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ADMIN_HOURS * 3600_000).toISOString(), ip: ctx.ip })
    await audit('admin-login', ctx)
    return send(res, 200, { ok: true }, { 'Set-Cookie': serializeCookie({ name: ADMIN_COOKIE, value: token, httpOnly: true, path: cookiePath, sameSite: 'Strict', maxAge: ADMIN_HOURS * 3600 }) })
  }

  const session = await adminSession(req)
  if (route === '/me') return send(res, 200, { signedIn: Boolean(session), totp: Boolean(config.totpSecret) })
  if (!session) return send(res, 401, { error: 'Sign in required.' })

  if (route === '/logout' && method === 'POST') {
    await authStore().setJSON('admin-sessions/' + sha(session.token), { email: session.email, expiresAt: new Date(0).toISOString() })
    await audit('admin-logout', ctx)
    return send(res, 200, { ok: true }, { 'Set-Cookie': serializeCookie({ name: ADMIN_COOKIE, value: '', httpOnly: true, path: cookiePath, sameSite: 'Strict', maxAge: 0 }) })
  }

  if (route === '/users' && method === 'GET') {
    const users = await listUsers()
    const rows = await Promise.all(users.map(async user => {
      const stats = await workspaceStats(user.workspaceId)
      const activity = await activityFor(user.id)
      return { ...publicUser(user), totals: stats.totals, podiums: stats.podiums, published: stats.published, lastActivity: activity[0] ?? null, resetRequested: activity.find(item => item.type === 'reset-requested' && !activity.some(other => other.type === 'password-reset' && other.at > item.at)) ? true : false }
    }))
    const linked = new Set(users.map(user => user.workspaceId))
    const unlinked = await Promise.all((await allWorkspaces()).filter(id => !linked.has(id)).map(async id => ({ workspaceId: id, totals: (await workspaceStats(id)).totals })))
    return send(res, 200, { users: rows, unlinkedWorkspaces: unlinked })
  }

  if (route === '/users' && method === 'POST') {
    const input = await body(req)
    if (typeof input.email !== 'string' || !/^\S+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254) return send(res, 400, { error: 'Enter a valid email.' })
    const workspaceId = typeof input.workspaceId === 'string' && input.workspaceId ? input.workspaceId : undefined
    if (workspaceId && (!(await allWorkspaces()).includes(workspaceId) || (await listUsers()).some(user => user.workspaceId === workspaceId))) return send(res, 400, { error: 'That workspace is unknown or already linked.' })
    const user = await createUser({ email: input.email, name: String(input.name ?? '').slice(0, 100), nickname: '', password: null, method: 'admin', ip: ctx.ip, workspaceId, verified: true })
    if (!user) return send(res, 409, { error: 'That email already has an account.' })
    const link = ctx.origin + ctx.basePath + '/#recovery_token=' + await issueToken(user.id, 'reset', 72)
    await audit('create-user', ctx, { userId: user.id, email: user.email, workspaceId: workspaceId ?? null })
    return send(res, 200, { user: publicUser(user), link })
  }

  if (route === '/audit' && method === 'GET') return send(res, 200, { audit: (await authStore().get('admin/audit', { type: 'json' })) ?? [] })

  const match = /^\/users\/([0-9a-f-]{36})(\/action)?$/.exec(route)
  if (!match) return send(res, 404, { error: 'Not found' })
  const user = await getUser(match[1])
  if (!user) return send(res, 404, { error: 'User not found.' })
  if (!match[2] && method === 'GET') {
    const [stats, activity] = await Promise.all([workspaceStats(user.workspaceId), activityFor(user.id)])
    return send(res, 200, { user: publicUser(user), stats, activity })
  }
  if (!match[2] || method !== 'POST') return send(res, 405, { error: 'Method not allowed' })
  const input = await body(req)
  const action = String(input.action ?? '')
  const done = async (result: Record<string, unknown> = {}) => { await audit(action, ctx, { userId: user.id, email: user.email }); return send(res, 200, { ok: true, ...result }) }
  switch (action) {
    case 'reset-link': {
      const link = ctx.origin + ctx.basePath + '/#recovery_token=' + await issueToken(user.id, 'reset', 24)
      return done({ link, note: 'Valid for 24 hours, once. Shown only now.' })
    }
    case 'email-reset':
    case 'email-verify': {
      const id = await emailAccountLink(action === 'email-reset' ? 'reset' : 'verify', user, ctx.ip)
      if (!id) return send(res, 502, { error: 'The email could not be sent. Use "Create reset link" and send it yourself.' })
      return done({ note: `Email sent (Resend id ${id}).` })
    }
    case 'temp-password': {
      const password = newToken(12).replace(/[-_]/g, 'x') + '-' + newToken(6).replace(/[-_]/g, 'y')
      const passwordHash = await hashPassword(password)
      await updateUser(user.id, current => ({ ...current, passwordHash, sessionEpoch: current.sessionEpoch + 1 }))
      await recordActivity(user.id, { type: 'admin-temp-password' })
      return done({ password, note: 'Shown only now. Ask them to change it with a reset link.' })
    }
    case 'logout':
      await updateUser(user.id, current => ({ ...current, sessionEpoch: current.sessionEpoch + 1 }))
      await recordActivity(user.id, { type: 'admin-force-logout' })
      return done()
    case 'disable':
    case 'enable':
      await updateUser(user.id, current => ({ ...current, disabledAt: action === 'disable' ? new Date().toISOString() : null, sessionEpoch: current.sessionEpoch + (action === 'disable' ? 1 : 0) }))
      await recordActivity(user.id, { type: 'admin-' + action })
      return done()
    case 'verify':
      await updateUser(user.id, current => ({ ...current, verifiedAt: current.verifiedAt ?? new Date().toISOString() }))
      await recordActivity(user.id, { type: 'admin-verify' })
      return done()
    case 'link-workspace': {
      const workspaceId = String(input.workspaceId ?? '')
      if (!(await allWorkspaces()).includes(workspaceId) || (await listUsers()).some(other => other.workspaceId === workspaceId)) return send(res, 400, { error: 'That workspace is unknown or already linked.' })
      await updateUser(user.id, current => ({ ...current, workspaceId }))
      await recordActivity(user.id, { type: 'admin-link-workspace', detail: workspaceId })
      return done()
    }
    case 'delete':
      if (normalEmail(String(input.confirm ?? '')) !== normalEmail(user.email)) return send(res, 400, { error: 'Type the user’s email to confirm.' })
      await deleteUser(user.id)
      return done({ note: 'Login removed. Their race data was kept.' })
    default:
      return send(res, 400, { error: 'Unknown action.' })
  }
}

export { findUserByEmail }
