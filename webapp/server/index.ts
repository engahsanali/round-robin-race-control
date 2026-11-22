// Node host for Race Manager outside Netlify. It serves the Vite build under
// RR_BASE_PATH, runs the Netlify function handlers against a local file store,
// handles accounts itself (server/auth.ts) and serves the private admin at <base>/admin.
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from '@netlify/functions'
import account from '../netlify/functions/account'
import events from '../netlify/functions/events'
import { createJar, scope } from './runtime'
import { useSessionReader } from '../netlify/functions/lib/account-store'
import { SESSION_COOKIE, sessionUser } from './auth'
import { handleAdmin } from './admin'

useSessionReader(async context => {
  const user = await sessionUser(context.cookies.get(SESSION_COOKIE))
  return user ? { id: user.workspaceId, email: user.email, name: user.name, nickname: user.nickname } : null
})

const port = Number(process.env.PORT || 8787)
const basePath = ('/' + (process.env.RR_BASE_PATH ?? '/roundrobin').replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '')
const staticDir = process.env.RR_STATIC_DIR || join(process.cwd(), 'dist')

const securityHeaders: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
}

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
}

type Handler = (req: Request, context: Context) => Promise<Response>
const routes: Array<{ pattern: RegExp; names: string[]; handler: Handler }> = [
  { pattern: /^\/api\/account$/, names: [], handler: account as Handler },
  { pattern: /^\/api\/events$/, names: [], handler: events as Handler },
  { pattern: /^\/api\/events\/([^/]+)$/, names: ['id'], handler: events as Handler },
  { pattern: /^\/api\/events\/([^/]+)\/groups\/([^/]+)$/, names: ['id', 'groupId'], handler: events as Handler },
  { pattern: /^\/api\/events\/([^/]+)\/(?:podiums|publication)$/, names: ['id'], handler: events as Handler },
  { pattern: /^\/api\/watch\/([^/]+)$/, names: ['code'], handler: events as Handler },
  { pattern: /^\/api\/history$/, names: [], handler: events as Handler },
]

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim()

function publicOrigin(req: IncomingMessage) {
  if (process.env.RR_PUBLIC_ORIGIN) return process.env.RR_PUBLIC_ORIGIN.replace(/\/$/, '')
  const proto = first(req.headers['x-forwarded-proto']) || 'http'
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost'
  return `${proto === 'https' ? 'https' : 'http'}://${host}`
}

function clientIp(req: IncomingMessage) {
  return first(req.headers['x-forwarded-for']) || first(req.headers['x-real-ip']) || req.socket.remoteAddress || '0.0.0.0'
}

function toHeaders(req: IncomingMessage) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(':')) continue
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
  }
  return headers
}

async function send(res: ServerResponse, response: Response, extra: Record<string, string> = {}, setCookies: string[] = []) {
  const headers: Record<string, string | string[]> = { ...extra }
  response.headers.forEach((value, name) => { if (name !== 'set-cookie') headers[name] = value })
  const cookies = [...response.headers.getSetCookie(), ...setCookies]
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers)
  if (!response.body) return res.end()
  Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(res)
}

function sendText(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders, ...headers })
  res.end(body)
}

async function runFunction(req: IncomingMessage, res: ServerResponse, path: string, search: string) {
  for (const route of routes) {
    const match = route.pattern.exec(path)
    if (!match) continue
    const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]))
    const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET')
    const request = new Request(publicOrigin(req) + path + search, {
      method: req.method,
      headers: toHeaders(req),
      body: hasBody ? Readable.toWeb(req) as ReadableStream : undefined,
      duplex: 'half',
    } as RequestInit)
    const setCookies: string[] = []
    const cookies = createJar(req.headers.cookie, setCookies)
    const ip = clientIp(req)
    const context = { params, ip, cookies, site: { url: publicOrigin(req) }, url: new URL(request.url) } as unknown as Context
    const response = await scope.run({ cookies, setCookies, ip, userAgent: String(req.headers['user-agent'] ?? ''), cookiePath: basePath || '/' }, () => route.handler(request, context))
    return send(res, response, {}, setCookies)
  }
  return send(res, Response.json({ error: 'Not found.' }, { status: 404 }))
}

async function serveStatic(res: ServerResponse, path: string, method: string) {
  const relativePath = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  if (relativePath.split(sep).includes('..')) return sendText(res, 400, 'Bad request')
  let file = join(staticDir, relativePath)
  let info = await stat(file).catch(() => null)
  if (info?.isDirectory()) { file = join(file, 'index.html'); info = await stat(file).catch(() => null) }
  const isAsset = relativePath.startsWith('assets' + sep) || relativePath.startsWith('assets/')
  if (!info?.isFile()) {
    if (isAsset || extname(relativePath)) return sendText(res, 404, 'Not found', { 'Cache-Control': 'no-store' })
    file = join(staticDir, 'index.html')
  }
  const body = await readFile(file)
  res.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Content-Length': String(body.length),
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    ...securityHeaders,
  })
  res.end(method === 'HEAD' ? undefined : body)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://local')
    const method = req.method ?? 'GET'
    if (url.pathname === '/healthz') return sendText(res, 200, 'ok', { 'Cache-Control': 'no-store' })
    if (basePath && url.pathname === basePath) return sendText(res, 301, '', { Location: basePath + '/' + url.search })
    if (basePath && !url.pathname.startsWith(basePath + '/')) return sendText(res, 404, 'Not found')
    const path = url.pathname.slice(basePath.length) || '/'
    if (path.startsWith('/api/')) return await runFunction(req, res, path, url.search)
    if (path === '/admin' || path.startsWith('/admin/')) return await handleAdmin(req, res, path.slice('/admin'.length), { origin: publicOrigin(req), ip: clientIp(req), basePath })
    if (method !== 'GET' && method !== 'HEAD') return sendText(res, 405, 'Method not allowed')
    return await serveStatic(res, path, method)
  } catch (error) {
    console.error('request failed', req.method, req.url?.split('?')[0], error instanceof Error ? error.message : error)
    if (!res.headersSent) sendText(res, 500, 'Server error')
    else res.end()
  }
})

server.listen(port, () => console.log(`Race Manager listening on ${port} at ${basePath || '/'}`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
