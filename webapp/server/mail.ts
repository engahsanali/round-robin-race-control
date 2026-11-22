// Transactional email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// Needs RESEND_API_KEY and RR_MAIL_FROM. Links use RR_APP_URL, never the request Host header,
// so a forged Host can't redirect reset links. If sending fails, callers fall back to the admin flag.
import { issueToken, recordActivity, type User } from './auth'

const RESEND_URL = 'https://api.resend.com/emails'
export const RESET_HOURS = 1
export const VERIFY_HOURS = 48

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RR_MAIL_FROM && appUrl())
}
export function appUrl() {
  return (process.env.RR_APP_URL ?? '').replace(/\/+$/, '')
}

export interface Mail { to: string; subject: string; text: string; html: string; tag: string }
export async function sendMail(mail: Mail, fetcher: typeof fetch = fetch): Promise<string> {
  const key = process.env.RESEND_API_KEY
  if (!key || !process.env.RR_MAIL_FROM) throw new Error('email not configured')
  const response = await fetcher(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RR_MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html,
      ...(process.env.RR_MAIL_REPLY_TO ? { reply_to: process.env.RR_MAIL_REPLY_TO } : {}),
      tags: [{ name: 'type', value: mail.tag }],
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string }
  if (!response.ok || !body.id) throw new Error(`resend ${response.status}: ${body.name ?? body.message ?? 'no id'}`)
  return body.id
}

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function accountEmail(kind: 'reset' | 'verify', user: Pick<User, 'email' | 'name'>, link: string): Mail {
  const hello = user.name ? `Hi ${user.name},` : 'Hi,'
  const reset = kind === 'reset'
  const subject = reset ? 'Reset your Round Robin Race Manager password' : 'Confirm your email for Round Robin Race Manager'
  const lead = reset
    ? `Someone asked to reset the password for your Round Robin Race Manager account (${user.email}). Use this link to choose a new one. It works once and expires in ${RESET_HOURS} hour.`
    : `Please confirm this email address for your Round Robin Race Manager account. The link works once and expires in ${VERIFY_HOURS} hours.`
  const ignore = reset ? "If you didn't ask for this, you can ignore this email. Your password won't change." : "If you didn't create this account, you can ignore this email."
  const button = reset ? 'Choose a new password' : 'Confirm my email'
  const text = `${hello}\n\n${lead}\n\n${link}\n\n${ignore}\n\nRound Robin Race Manager · https://ahsantechlabs.com/roundrobin/\nQuestions? Reply to this email or write to contact@ahsantechlabs.com.`
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1b2330">
<div style="max-width:520px;margin:0 auto;padding:28px 22px;background:#fff">
<p style="font-size:18px;font-weight:600;margin:0 0 16px">Round Robin Race Manager</p>
<p>${esc(hello)}</p><p>${esc(lead)}</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#1d4ed8;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;display:inline-block">${button}</a></p>
<p style="font-size:13px;color:#5b6573">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="font-size:13px;color:#5b6573">${esc(ignore)}</p>
<p style="font-size:12px;color:#8a93a0;margin-top:28px">Round Robin Race Manager · <a href="https://ahsantechlabs.com/roundrobin/" style="color:#8a93a0">ahsantechlabs.com/roundrobin</a> · <a href="https://ahsantechlabs.com/roundrobin/privacy" style="color:#8a93a0">Privacy</a><br>Questions? Reply to this email or write to contact@ahsantechlabs.com.</p>
</div></body></html>`
  return { to: user.email, subject, text, html, tag: kind }
}

/** Issues a one-time token and emails the link. Returns the Resend id, or null after recording the admin fallback. */
export async function emailAccountLink(kind: 'reset' | 'verify', user: User, ip?: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!mailConfigured()) {
    if (kind === 'reset') await recordActivity(user.id, { type: 'reset-requested', ip, detail: 'email not configured' })
    return null
  }
  const token = await issueToken(user.id, kind, kind === 'reset' ? RESET_HOURS : VERIFY_HOURS)
  const link = `${appUrl()}/#${kind === 'reset' ? 'recovery_token' : 'confirmation_token'}=${token}`
  try {
    const id = await sendMail(accountEmail(kind, user, link), fetcher)
    await recordActivity(user.id, { type: kind === 'reset' ? 'reset-email-sent' : 'verify-email-sent', ip, detail: id })
    return id
  } catch (error) {
    console.error(`${kind} email failed:`, error instanceof Error ? error.message : error)
    await recordActivity(user.id, { type: kind === 'reset' ? 'reset-requested' : 'verify-email-failed', ip, detail: 'email failed' })
    return null
  }
}
