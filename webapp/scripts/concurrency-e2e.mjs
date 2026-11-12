import { chromium } from 'playwright-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { executablePath } from './browser.mjs'

const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '')
if (!baseUrl || baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
  throw new Error('Set BASE_URL to a deployed Netlify URL so bracket storage can be tested.')
}

const artifacts = new URL('../artifacts/', import.meta.url)
const screenshots = new URL('../docs/screenshots/', import.meta.url)
const localPath = (root, name) => fileURLToPath(new URL(name, root))
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
await Promise.all([mkdir(artifacts, { recursive: true }), mkdir(screenshots, { recursive: true })])

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const tabA = await context.newPage()
const tabB = await context.newPage()
const errors = []
for (const page of [tabA, tabB]) {
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()) })
  page.on('pageerror', error => errors.push(error.message))
}

const groupSave = page => page.waitForResponse(response => response.request().method() === 'PUT' && /\/api\/events\/[^/]+\/groups\/[^/]+$/.test(new URL(response.url()).pathname) && response.status() === 200)
const fillBracket = async (page, owner, firstCar) => {
  for (let i = 1; i <= 6; i++) {
    await page.getByLabel(`Competitor ${i} name`).fill(owner)
    await page.getByLabel(`Competitor ${i} car number`).fill(`${firstCar + i - 1}`)
  }
  await page.getByText(/Schedule ready · 8 heats/).waitFor()
}

await tabA.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
await tabA.getByLabel('Event name').fill('Two Bracket Concurrency Test')
await tabA.getByLabel('Venue').fill('Parallel Test Track')
await tabA.getByRole('button', { name: 'Create event' }).click()
await tabA.getByRole('heading', { name: 'Overview' }).waitFor()
const adminUrl = tabA.url()

await tabB.goto(adminUrl, { waitUntil: 'networkidle' })
await Promise.all([
  tabA.getByRole('button', { name: 'Entries', exact: true }).click(),
  tabB.getByRole('button', { name: 'Entries', exact: true }).click(),
])
await tabB.getByRole('button', { name: 'Bracket B', exact: true }).click()

const entrySaveA = groupSave(tabA)
const entrySaveB = groupSave(tabB)
await Promise.all([fillBracket(tabA, 'Owner A', 101), fillBracket(tabB, 'Owner B', 201)])
await Promise.all([entrySaveA, entrySaveB])

await tabA.screenshot({ path: localPath(screenshots, `v${version}-bracket-a.png`), fullPage: true })
await tabB.screenshot({ path: localPath(screenshots, `v${version}-bracket-b.png`), fullPage: true })

await Promise.all([
  tabA.getByRole('button', { name: 'Race day', exact: true }).click(),
  tabB.getByRole('button', { name: 'Race day', exact: true }).click(),
])
await tabB.getByRole('button', { name: 'Bracket B', exact: true }).click()
await Promise.all([
  tabA.getByText(/Schedule ready · 8 heats/).first().waitFor(),
  tabB.getByText(/Schedule ready · 8 heats/).first().waitFor(),
])

const resultSaveA = groupSave(tabA)
const resultSaveB = groupSave(tabB)
await Promise.all([
  tabA.locator('.schedule-panel .lanes button').first().click(),
  tabB.locator('.schedule-panel .lanes button').first().click(),
])
await Promise.all([resultSaveA, resultSaveB])

await tabA.screenshot({ path: localPath(screenshots, `v${version}-simultaneous-results.png`), fullPage: true })

const url = new URL(adminUrl)
const eventId = url.searchParams.get('event')
const ownerKey = new URLSearchParams(url.hash.slice(1)).get('key')
if (!eventId || !ownerKey) throw new Error('Created event did not provide its private admin credentials.')
const headers = { 'Content-Type': 'application/json', 'x-event-key': ownerKey }
const read = await fetch(`${baseUrl}/api/events/${eventId}`, { headers: { 'x-event-key': ownerKey } })
const data = await read.json()
if (!read.ok || data.role !== 'owner') throw new Error('Could not reload the concurrent event.')
const groups = data.event.mainClasses[0].groups
const bracketA = groups.find(group => group.label === 'Bracket A')
const bracketB = groups.find(group => group.label === 'Bracket B')
if (!bracketA || !bracketB) throw new Error('The two brackets were not returned after concurrent saving.')
if (bracketA.entrants.filter(entry => entry.name).length !== 6 || bracketB.entrants.filter(entry => entry.name).length !== 6) throw new Error('One bracket roster overwrote the other.')
if (bracketA.heats.filter(heat => heat.winnerId).length !== 1 || bracketB.heats.filter(heat => heat.winnerId).length !== 1) throw new Error('One bracket result overwrote the other.')
if (!(bracketA.revision >= 2 && bracketB.revision >= 2)) throw new Error('Independent bracket revisions did not advance.')

await Promise.all([tabA.reload({ waitUntil: 'networkidle' }), tabB.reload({ waitUntil: 'networkidle' })])
await Promise.all([
  tabA.getByRole('button', { name: 'Race day', exact: true }).click(),
  tabB.getByRole('button', { name: 'Race day', exact: true }).click(),
])
await Promise.all([
  tabA.getByText(/Racing · 1 of 8 heats complete/).first().waitFor(),
  tabB.getByText(/Racing · 1 of 8 heats complete/).first().waitFor(),
])
const sameGroupSave = page => page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith(`/groups/${bracketA.id}`) && [200, 409].includes(response.status()))
const sameGroupSaveA = sameGroupSave(tabA)
const sameGroupSaveB = sameGroupSave(tabB)
await Promise.all([
  tabA.locator('.schedule-panel .heat-card').nth(1).locator('.lanes button').first().click(),
  tabB.locator('.schedule-panel .heat-card').nth(1).locator('.lanes button').nth(1).click(),
])
const uiSameGroupResponses = await Promise.all([sameGroupSaveA, sameGroupSaveB])
const uiSameGroupStatuses = uiSameGroupResponses.map(response => response.status()).sort((a, b) => a - b)
if (uiSameGroupStatuses.join(',') !== '200,409') throw new Error(`Same-bracket UI conflict check returned ${uiSameGroupStatuses.join(',')}.`)
const losingTab = uiSameGroupResponses[0].status() === 409 ? tabA : tabB
await losingTab.getByText(/changed in another tab/).waitFor()
await losingTab.screenshot({ path: localPath(screenshots, `v${version}-conflict-protection.png`), fullPage: true })
await losingTab.getByRole('button', { name: 'Use saved bracket' }).click()

const latestRead = await fetch(`${baseUrl}/api/events/${eventId}`, { headers: { 'x-event-key': ownerKey } })
const latestData = await latestRead.json()
const latestA = latestData.event.mainClasses[0].groups.find(group => group.id === bracketA.id)
if (!latestRead.ok || !latestA) throw new Error('Could not reload the latest bracket revision for the atomic API check.')
const variantOne = { ...structuredClone(latestA), label: 'Bracket A - tab one' }
const variantTwo = { ...structuredClone(latestA), label: 'Bracket A - tab two' }
const auditA = latestData.event.audit.filter(item => item.groupId === latestA.id)
const sameGroupResponses = await Promise.all([variantOne, variantTwo].map(group => fetch(`${baseUrl}/api/events/${eventId}/groups/${group.id}`, {
  method: 'PUT', headers, body: JSON.stringify({ group, audit: auditA, expectedRevision: latestA.revision }),
})))
const sameGroupStatuses = sameGroupResponses.map(response => response.status).sort((a, b) => a - b)
if (sameGroupStatuses.join(',') !== '200,409') throw new Error(`Same-bracket atomic conflict check returned ${sameGroupStatuses.join(',')}.`)

const unauthorized = await fetch(`${baseUrl}/api/events/${eventId}/groups/${bracketB.id}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group: bracketB, audit: [], expectedRevision: bracketB.revision }),
})
if (unauthorized.status !== 401) throw new Error('Bracket update without the private key was not rejected.')
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)

const result = {
  status: 'PASS', baseUrl, eventId, bracketARevision: bracketA.revision, bracketBRevision: bracketB.revision,
  bracketAWinners: 1, bracketBWinners: 1, uiSameGroupStatuses, sameGroupStatuses, unauthorizedStatus: unauthorized.status,
  screenshots: [`docs/screenshots/v${version}-bracket-a.png`, `docs/screenshots/v${version}-bracket-b.png`, `docs/screenshots/v${version}-simultaneous-results.png`, `docs/screenshots/v${version}-conflict-protection.png`],
  consoleErrors: errors,
}
await writeFile(new URL('concurrency-result.json', artifacts), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000))])
process.exit(0)
