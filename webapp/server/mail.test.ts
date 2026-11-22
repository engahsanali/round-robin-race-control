import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { activityFor, consumeToken, createUser } from './auth'
import { accountEmail, emailAccountLink } from './mail'

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rr-mail-')); process.env.RR_DATA_DIR = dir
  process.env.RESEND_API_KEY = 'test-key'; process.env.RR_MAIL_FROM = 'Round Robin <contact@example.test>'
  process.env.RR_MAIL_REPLY_TO = 'contact@example.test'; process.env.RR_APP_URL = 'https://example.test/roundrobin/'
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('account emails', () => {
  it('escapes user input in the HTML body', () => {
    const mail = accountEmail('reset', { email: 'a@b.test', name: '<script>x</script>' }, 'https://example.test/roundrobin/#recovery_token=abc')
    expect(mail.html).not.toContain('<script>')
    expect(mail.text).toContain('#recovery_token=abc')
  })
  it('sends a one-time reset link from RR_APP_URL through Resend', async () => {
    const user = (await createUser({ email: 'mail@example.test', name: 'Mail', nickname: '', password: null, method: 'email' }))!
    let sent: Record<string, unknown> = {}
    let auth = ''
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body)); auth = String((init.headers as Record<string, string>).Authorization)
      return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await emailAccountLink('reset', user, '1.2.3.4', fetcher)).toBe('msg_123')
    expect(auth).toBe('Bearer test-key')
    expect(sent.from).toBe('Round Robin <contact@example.test>')
    expect(sent.reply_to).toBe('contact@example.test')
    const token = /#recovery_token=([A-Za-z0-9_-]+)/.exec(String(sent.text))![1]
    expect(String(sent.text)).toContain('https://example.test/roundrobin/#recovery_token=')
    expect(await consumeToken(token, 'reset')).toBe(user.id)
    expect(await consumeToken(token, 'reset')).toBeNull()
    expect((await activityFor(user.id))[0].type).toBe('reset-email-sent')
  })
  it('falls back to the admin flag when Resend fails', async () => {
    const user = (await createUser({ email: 'fail@example.test', name: '', nickname: '', password: null, method: 'email' }))!
    const fetcher = (async () => new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 })) as unknown as typeof fetch
    expect(await emailAccountLink('reset', user, undefined, fetcher)).toBeNull()
    expect((await activityFor(user.id))[0].type).toBe('reset-requested')
  })
})
