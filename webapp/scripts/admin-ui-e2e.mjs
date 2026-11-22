// Browser check of the admin dashboard: sign in with TOTP, leaderboard, user detail, sort and filter.
// Usage: BASE_URL=... ADMIN_CREDS=/path/admin-login.json SHOTS=dir node scripts/admin-ui-e2e.mjs
import { chromium } from 'playwright-core'
import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { executablePath } from './browser.mjs'

const base = (process.env.BASE_URL || '').replace(/\/$/, '')
const creds = JSON.parse(readFileSync(process.env.ADMIN_CREDS, 'utf8'))
const shots = process.env.SHOTS || 'artifacts'
mkdirSync(shots, { recursive: true })
function hotp(secret, counter) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, value = 0; const bytes = []
  for (const c of secret) { value = (value << 5) | alphabet.indexOf(c); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8 } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter))
  const d = createHmac('sha1', Buffer.from(bytes)).update(msg).digest(); const o = d[d.length - 1] & 15
  return String((d.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}
// Use a fresh 30-second window so an earlier code is never replayed.
await new Promise(ok => setTimeout(ok, 30_500 - (Date.now() % 30_000)))
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const results = {}
await page.goto(base + '/admin/', { waitUntil: 'networkidle' })
await page.getByLabel('Email').fill(creds.email)
await page.getByLabel('Password').fill(creds.password)
await page.getByLabel('Authenticator code').fill(hotp(creds.totpSecret, Math.floor(Date.now() / 30000)))
await page.getByRole('button', { name: 'Sign in' }).click()
await page.locator('tbody tr').first().waitFor()
results.rows = await page.locator('tbody tr').count()
const cookie = (await page.context().cookies()).find(c => c.name === 'rr_admin')
results.adminCookie = cookie && { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, path: cookie.path }
await page.screenshot({ path: join(shots, 'admin-leaderboard.png'), fullPage: true })
await page.selectOption('#board', 'heatsRun')
await page.fill('#q', 'nobody-matches-this')
await page.waitForTimeout(400)
results.filteredRows = await page.locator('tbody tr[data-id]').count()
await page.fill('#q', '')
await page.waitForTimeout(400)
await page.locator('tbody tr[data-id]').first().click()
await page.locator('#detail [data-act]').first().waitFor()
results.detailActions = await page.locator('#detail [data-act]').evaluateAll(b => b.map(x => x.getAttribute('data-act')))
await page.screenshot({ path: join(shots, 'admin-user-detail.png'), fullPage: true })
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: join(shots, 'admin-mobile.png'), fullPage: true })
await page.getByRole('button', { name: 'Sign out' }).click()
await page.getByLabel('Authenticator code').waitFor()
results.signedOut = true
results.pageErrors = errors
await browser.close()
console.log(JSON.stringify(results, null, 1))
if (errors.length || !results.rows) process.exit(1)
