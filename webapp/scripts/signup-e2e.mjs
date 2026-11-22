// Real sign-up through the self-hosted account screen, then sign-out, sign-in, a saved event and the forgot-password note.
// Usage: BASE_URL=http://host/roundrobin RACE_E2E_EMAIL=... RACE_E2E_PASSWORD=... node scripts/signup-e2e.mjs
import { chromium } from 'playwright-core'
import { executablePath } from './browser.mjs'
import { signInForTest } from './identity-e2e.mjs'

const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '')
const email = process.env.RACE_E2E_EMAIL
const password = process.env.RACE_E2E_PASSWORD
const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const results = {}

await page.goto(baseUrl + '/', { waitUntil: 'networkidle' })
results.googleButton = await page.getByRole('button', { name: 'Continue with Google' }).count()
await page.getByRole('button', { name: 'Sign up', exact: true }).click()
await page.getByLabel('Your name').fill('Signup E2E')
await page.getByLabel('Email', { exact: true }).fill(email)
await page.getByLabel('Password', { exact: true }).fill(password)
await page.getByRole('button', { name: 'Create account' }).click()
await page.getByRole('button', { name: 'Create event', exact: true }).waitFor()
results.signedInAfterSignup = true
const cookie = (await context.cookies()).find(c => c.name === 'rr_session')
results.cookie = cookie && { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, path: cookie.path, secure: cookie.secure }

await page.getByLabel('Event name').fill('Signup E2E Event')
await page.getByLabel('Venue').fill('E2E Track')
await page.getByRole('button', { name: 'Create event' }).click()
await page.getByRole('heading', { name: 'Overview' }).waitFor()
await page.waitForTimeout(1500)
await page.goto(baseUrl + '/', { waitUntil: 'networkidle' })
await page.getByText('Signup E2E Event').first().waitFor()
results.eventSavedAndListedAfterReload = true

await page.getByRole('button', { name: 'Sign out' }).click()
await page.getByRole('button', { name: 'Sign in', exact: true }).last().waitFor()
results.signedOut = true
await page.getByRole('button', { name: 'Forgot password?' }).click()
await page.getByLabel('Email', { exact: true }).fill(email)
await page.getByRole('button', { name: 'Send reset email' }).click()
await page.getByText(/admin/i).first().waitFor()
results.forgotMessage = (await page.getByText(/admin/i).first().innerText()).slice(0, 160)
await page.getByRole('button', { name: 'Back to sign in' }).click()
await page.getByLabel('Email', { exact: true }).fill(email)
await page.getByLabel('Password', { exact: true }).fill('definitely the wrong passphrase')
await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
await page.waitForTimeout(1500)
results.wrongPasswordRejected = await page.getByRole('button', { name: 'Create event', exact: true }).count() === 0
await page.getByLabel('Password', { exact: true }).fill('')
await signInForTest(page)
await page.getByText('Signup E2E Event').first().waitFor()
results.signInAgainSeesEvent = true
results.pageErrors = errors
await browser.close()
console.log(JSON.stringify(results, null, 1))
if (errors.length) process.exit(1)
