// End-to-end check of self-hosted accounts and the admin dashboard API.
// Usage: BASE_URL=http://host/roundrobin ADMIN_CREDS=/path/admin-login.json TEST_EMAIL=... TEST_PASSWORD=... node scripts/admin-e2e.mjs
// ADMIN_CREDS holds {"email","password","totpSecret"}. Nothing secret is printed.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const base = (process.env.BASE_URL || '').replace(/\/$/, '')
const origin = new URL(base).origin
const creds = JSON.parse(readFileSync(process.env.ADMIN_CREDS, 'utf8'))
const testEmail = process.env.TEST_EMAIL
let testPassword = process.env.TEST_PASSWORD

function hotp(secret, counter) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, value = 0; const bytes = []
  for (const c of secret.replace(/=+$/, '')) { value = (value << 5) | alphabet.indexOf(c); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter))
  const d = createHmac('sha1', Buffer.from(bytes)).update(msg).digest(); const o = d[d.length - 1] & 15
  return String((d.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

class Client {
  cookies = new Map()
  async call(path, { method = 'GET', body } = {}) {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); const v = pair.slice(i + 1); if (/Max-Age=0/i.test(c) || !v) this.cookies.delete(pair.slice(0, i)); else this.cookies.set(pair.slice(0, i), v) }
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  }
}
const results = {}
const userLogin = async password => { const c = new Client(); const r = await c.call('/api/account', { method: 'POST', body: { action: 'login', email: testEmail, password } }); return { c, status: r.status } }

// Admin sign-in: wrong code, then right code.
const admin = new Client()
results.adminPageStatus = (await fetch(base + '/admin/')).status
results.adminUnauthenticated = (await admin.call('/admin/api/users')).status
results.adminWrongCode = (await admin.call('/admin/api/login', { method: 'POST', body: { email: creds.email, password: creds.password, code: '000000' } })).status
results.adminCrossSite = (await fetch(base + '/admin/api/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status
const code = hotp(creds.totpSecret, Math.floor(Date.now() / 30000))
results.adminLogin = (await admin.call('/admin/api/login', { method: 'POST', body: { email: creds.email, password: creds.password, code } })).status
assert.equal(results.adminLogin, 200)

const list = (await admin.call('/admin/api/users')).data
const row = list.users.find(u => u.email.toLowerCase() === testEmail.toLowerCase())
assert.ok(row, 'test user missing from dashboard')
results.dashboardRow = { signupMethod: row.signupMethod, verified: Boolean(row.verifiedAt), loginCount: row.loginCount, events: row.totals.events, brackets: row.totals.brackets, racesRun: row.totals.heatsRun, hasPasswordHashField: 'passwordHash' in row }
const detail = (await admin.call('/admin/api/users/' + row.id)).data
results.detailActivityTypes = [...new Set(detail.activity.map(a => a.type))]
const act = body => admin.call(`/admin/api/users/${row.id}/action`, { method: 'POST', body })

// Session that should be killed by force sign-out.
const live = await userLogin(testPassword)
results.userSignIn = live.status
results.forceLogout = (await act({ action: 'logout' })).status
results.sessionAfterForceLogout = (await live.c.call('/api/history')).status

// Reset link flow.
const reset = (await act({ action: 'reset-link' })).data
const token = new URLSearchParams(new URL(reset.link).hash.slice(1)).get('recovery_token')
testPassword = 'reset by admin e2e ' + Date.now()
results.resetWithLink = (await new Client().call('/api/account', { method: 'POST', body: { action: 'reset', tokenHash: token, password: testPassword } })).status
results.resetLinkReuse = (await new Client().call('/api/account', { method: 'POST', body: { action: 'reset', tokenHash: token, password: testPassword + 'x' } })).status
results.signInWithResetPassword = (await userLogin(testPassword)).status

// Temporary password.
const temp = (await act({ action: 'temp-password' })).data.password
results.signInWithTempPassword = (await userLogin(temp)).status
results.oldPasswordAfterTemp = (await userLogin(testPassword)).status

// Disable / enable / verify.
results.disable = (await act({ action: 'disable' })).status
results.signInWhileDisabled = (await userLogin(temp)).status
results.enable = (await act({ action: 'enable' })).status
results.signInAfterEnable = (await userLogin(temp)).status
results.verify = (await act({ action: 'verify' })).status

// Audit log.
const audit = (await admin.call('/admin/api/audit')).data.audit
results.auditActions = [...new Set(audit.filter(a => a.userId === row.id).map(a => a.action))]

// Delete with confirmation.
if (process.env.KEEP_USER !== '1') {
  results.deleteWrongConfirm = (await act({ action: 'delete', confirm: 'someone@else.test' })).status
  results.delete = (await act({ action: 'delete', confirm: testEmail })).status
  results.signInAfterDelete = (await userLogin(temp)).status
  results.userStillListed = (await admin.call('/admin/api/users')).data.users.some(u => u.id === row.id)
}
results.adminLogout = (await admin.call('/admin/api/logout', { method: 'POST' })).status
results.adminAfterLogout = (await admin.call('/admin/api/users')).status
console.log(JSON.stringify(results, null, 1))
