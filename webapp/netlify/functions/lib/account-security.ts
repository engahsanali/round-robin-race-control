import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const common = new Set(['passwordpassword', 'password12345678', '123456789012345', '1234567890123456', 'qwertyuiopasdfgh', 'correct horse battery staple'])

export function acceptsPassword(value: unknown): value is string {
  return typeof value === 'string' && [...value].length >= 15 && Buffer.byteLength(value, 'utf8') <= 72 &&
    value.trim().length > 0 && !common.has(value.toLowerCase()) && !/^(.)\1{14,}$/su.test(value)
}

export function isSameOriginWrite(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site'
}

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const token = (bytes = 24) => randomBytes(bytes).toString('base64url')
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(value)
export const validUserId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)

export function matchesDigest(value: string, hash: string) {
  return /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(hash, 'hex'))
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'private, no-store')
  responseHeaders.set('X-Content-Type-Options', 'nosniff')
  responseHeaders.set('Referrer-Policy', 'no-referrer')
  return Response.json(data, { status, headers: responseHeaders })
}

export async function requestBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new RangeError('Request too large')
  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError('Missing request body')
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        await reader.cancel()
        throw new RangeError('Request too large')
      }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally {
    reader.releaseLock()
  }
}
