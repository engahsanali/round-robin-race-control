// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for the admin login.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buffer: Buffer) {
  let bits = 0, value = 0, out = ''
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0, value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error('Invalid base32')
    value = (value << 5) | index; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function hotp(secret: string, counter: number) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = digest[digest.length - 1] & 15
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return code.toString().padStart(6, '0')
}

let lastAccepted = -1
/** Accepts the current code or one step either side, and never the same step twice. */
export function verifyTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false
  const step = Math.floor(now / 30_000)
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate <= lastAccepted) continue
    if (timingSafeEqual(Buffer.from(hotp(secret, candidate)), Buffer.from(code))) { lastAccepted = candidate; return true }
  }
  return false
}
