// Local stand-in for Netlify Identity (GoTrue) used only by the self-hosted
// E2E run. Serves HTTPS because the account code always calls Identity over
// HTTPS. Usage: node scripts/mock-identity.mjs <cert.pem> <key.pem> [port]
import { createServer } from 'node:https'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const [cert, key, port = '9443'] = process.argv.slice(2)
const users = new Map()
const tokens = new Map()
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')

function issue(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, exp })}.mock${randomUUID().replaceAll('-', '')}`
  tokens.set(token, user)
  return { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: randomUUID().replaceAll('-', '') }
}

function addUser(email, password, data = {}) {
  const user = { id: randomUUID(), email, password, confirmed_at: new Date().toISOString(), user_metadata: data, app_metadata: { provider: 'email' } }
  users.set(email.toLowerCase(), user)
  return user
}
addUser(process.env.RACE_E2E_EMAIL || 'organiser@example.test', process.env.RACE_E2E_PASSWORD || 'local mock passphrase for e2e', { full_name: 'Local Organiser' })

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
const publicUser = user => ({ id: user.id, email: user.email, confirmed_at: user.confirmed_at, user_metadata: user.user_metadata, app_metadata: user.app_metadata })

createServer({ cert: readFileSync(cert), key: readFileSync(key) }, async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const path = new URL(req.url, 'https://local').pathname.replace(/^\/\.netlify\/identity/, '')
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '')
  if (path === '/settings') return send(res, 200, { external: { google: false, github: false, gitlab: false, bitbucket: false, email: true }, disable_signup: false, autoconfirm: false })
  if (path === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(body)
    const user = users.get(String(form.get('username')).toLowerCase())
    if (form.get('grant_type') !== 'password' || !user || user.password !== form.get('password')) return send(res, 400, { error: 'invalid_grant', error_description: 'No user found with that email, or password invalid.' })
    return send(res, 200, issue(user))
  }
  if (path === '/user' && req.method === 'GET') {
    const user = tokens.get(bearer)
    return user ? send(res, 200, publicUser(user)) : send(res, 401, { code: 401, msg: 'Invalid token' })
  }
  if (path === '/logout') { tokens.delete(bearer); res.writeHead(204); return res.end() }
  if (path === '/signup' && req.method === 'POST') { const input = JSON.parse(body); const user = addUser(input.email, input.password, input.data); return send(res, 200, publicUser(user)) }
  if (path === '/recover') return send(res, 200, {})
  return send(res, 404, { code: 404, msg: 'Not found' })
}).listen(Number(port), '127.0.0.1', () => console.log('mock identity on', port))
