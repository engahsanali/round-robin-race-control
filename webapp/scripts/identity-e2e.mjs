export async function signInForTest(page) {
  const email = process.env.RACE_E2E_EMAIL
  const password = process.env.RACE_E2E_PASSWORD
  if (!email || !password) throw new Error('Set RACE_E2E_EMAIL and RACE_E2E_PASSWORD for a verified Race Manager test account.')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByRole('button', { name: 'Create event', exact: true }).waitFor()
}

export async function mockOrganiser(context, list = () => []) {
  const account = { id: 'fixture-account', name: 'Test Organiser', nickname: '', email: 'test@example.test', timezone: 'Australia/Perth', entryFee: 15 }
  const recoveryKey = Buffer.alloc(32, 11).toString('base64url')
  await context.route('**/api/account', route => route.fulfill({ json: { account, recoveryKey, events: list() } }))
  await context.route('**/api/history', route => route.fulfill({ json: { history: [] } }))
}
