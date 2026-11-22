// Creates the Race Manager admin login. Writes two files and prints neither secret.
// Usage: node scripts/make-admin.mjs <email> <config-out.json> <login-out.json>
//   config-out: {email, passwordHash, totpSecret} for the app (RR_ADMIN_FILE)
//   login-out:  {email, password, totpSecret, otpauth} for the owner only (keep root-only)
import { randomBytes, scrypt } from 'node:crypto'
import { writeFileSync } from 'node:fs'
const [email, configOut, loginOut] = process.argv.slice(2)
if (!email || !configOut || !loginOut) { console.error('usage: make-admin.mjs <email> <config.json> <login.json>'); process.exit(2) }
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const raw = randomBytes(20); let bits = 0, value = 0, totpSecret = ''
for (const byte of raw) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { totpSecret += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5 } }
if (bits > 0) totpSecret += alphabet[(value << (5 - bits)) & 31]
const password = randomBytes(18).toString('base64url')
const salt = randomBytes(16)
const hash = await new Promise((ok, fail) => scrypt(password.normalize('NFKC'), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? fail(e) : ok(k)))
const passwordHash = `scrypt$32768$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`
const otpauth = `otpauth://totp/${encodeURIComponent('Race Manager Admin:' + email)}?secret=${totpSecret}&issuer=${encodeURIComponent('Race Manager Admin')}&algorithm=SHA1&digits=6&period=30`
writeFileSync(configOut, JSON.stringify({ email, passwordHash, totpSecret }, null, 2) + '\n', { mode: 0o400 })
writeFileSync(loginOut, JSON.stringify({ email, password, totpSecret, otpauth, url: 'https://ahsantechlabs.com/roundrobin/admin/' }, null, 2) + '\n', { mode: 0o600 })
console.log('admin files written (secrets not shown)')
