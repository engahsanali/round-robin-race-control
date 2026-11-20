import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { executablePath } from './browser.mjs'

const root = new URL('../artifacts/', import.meta.url)
const path = name => fileURLToPath(new URL(name, root))
const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const deployed = !baseUrl.includes('127.0.0.1') && !baseUrl.includes('localhost')
await mkdir(root, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()) })
page.on('pageerror', error => errors.push(error.message))

await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
const credit = page.getByRole('contentinfo').filter({ hasText: 'Created by Ahsan Ali' })
if (!(await credit.innerText()).includes('Free to use.') || await credit.getByRole('link').count() !== 1) {
  throw new Error('Home page credit did not show the free-to-use message and website only')
}
if (await credit.getByRole('link', { name: 'AhsanTechLabs.com' }).getAttribute('href') !== 'https://ahsantechlabs.com/') {
  throw new Error('Creator credit link is missing or incorrect')
}
await page.screenshot({ path: path('landing-desktop.png') })
await page.getByLabel('Event name').fill('Web App Acceptance Race')
await page.getByLabel('Venue').fill('Test Track')
await page.getByRole('button', { name: 'Create event' }).click()
await page.getByRole('heading', { name: 'Overview' }).waitFor()
await page.getByRole('button', { name: 'Entries', exact: true }).click()
for (let i = 1; i <= 6; i++) {
  await page.getByLabel(`Competitor ${i} name`).fill(i <= 4 ? 'Shared Owner' : `Racer ${i}`)
  await page.getByLabel(`Competitor ${i} car number`).fill(`${i}`)
}
await page.getByText(/Schedule ready · 8 heats/).waitFor()
await page.screenshot({ path: path('duplicate-owner-entries-desktop.png'), fullPage: true })
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: path('duplicate-owner-entries-mobile.png'), fullPage: true })
await page.setViewportSize({ width: 1440, height: 1000 })
await page.getByRole('button', { name: 'Race day' }).click()
await page.locator('.lanes button').first().click()
await page.getByText(/Racing · 1 of 8 heats complete/).first().waitFor()
if (!(await page.getByLabel('Competitor 1 name').isDisabled())) throw new Error('Roster did not lock after result')

await page.getByRole('button', { name: 'Entries', exact: true }).click()
for (const category of ['Stock Advance', 'BMAX Speed']) {
  await page.getByRole('button', { name: category, exact: true }).click()
  await page.getByLabel('Competitor 1 name').fill('Shared Owner')
  await page.getByLabel('Competitor 1 car number').fill('1')
}
await page.getByRole('button', { name: 'Finals', exact: true }).click()
for (const category of ['Stock Advance', 'BMAX Speed']) {
  await page.getByRole('button', { name: category, exact: true }).click()
  await page.getByLabel('Competitor 1 name').fill('Shared Owner')
  await page.getByLabel('Competitor 1 car number').fill('1')
}

await page.getByRole('button', { name: 'Fees', exact: true }).click()
const sharedOwnerFee = page.locator('.fees-row').filter({ hasText: 'Shared Owner' })
await sharedOwnerFee.waitFor()
if ((await page.locator('.fees-row').count()) !== 3) throw new Error('Repeated owner names were not consolidated in the fee tally')
const feeTable = page.getByRole('table', { name: 'Entry fees by competitor and category' })
const assertFeeCell = async (row, column, expected) => {
  const headers = await feeTable.getByRole('columnheader').allTextContents()
  const index = headers.indexOf(column)
  if (index === -1 || await row.getByRole('cell').nth(index - 1).innerText() !== expected) {
    throw new Error(`Unexpected fee tally in ${column}: expected ${expected}`)
  }
}
await assertFeeCell(sharedOwnerFee, 'Box Stock', '4\n$60.00')
await assertFeeCell(sharedOwnerFee, 'Stock Advance', '1\n$15.00')
await assertFeeCell(sharedOwnerFee, 'BMAX Speed', '1\n$15.00')
await assertFeeCell(sharedOwnerFee, 'Total entries', '6')
await assertFeeCell(sharedOwnerFee, 'Total due', '$90.00')
const feeHeaders = await feeTable.getByRole('columnheader').allTextContents()
const dueIndex = feeHeaders.indexOf('Total due')
if (feeHeaders.slice(dueIndex + 1, dueIndex + 3).join(',') !== 'Prize,Paid') throw new Error('Prize belongs between Total due and Paid')
await page.getByLabel('Prize for Shared Owner').fill('12.50')
await page.getByLabel('Paid by Shared Owner').fill('30')
await assertFeeCell(sharedOwnerFee, 'Balance', '$47.50')
const eventTotal = feeTable.locator('tfoot tr')
await assertFeeCell(eventTotal, 'Box Stock', '6\n$90.00')
await assertFeeCell(eventTotal, 'Total entries', '8')
await assertFeeCell(eventTotal, 'Total due', '$120.00')
await assertFeeCell(eventTotal, 'Prize', '$12.50')
await assertFeeCell(eventTotal, 'Balance', '$77.50')
await page.screenshot({ path: path('fees-desktop.png') })

await page.getByRole('button', { name: 'Reraces', exact: true }).click()
for (let i = 1; i <= 4; i++) {
  await page.getByLabel(`Competitor ${i} name`).fill(`Tie Racer ${i}`)
  await page.getByLabel(`Competitor ${i} car number`).fill(`${100 + i}`)
}
await page.getByText(/Schedule ready · 6 heats/).first().waitFor()
if ((await page.locator('.schedule-panel .heat-card').count()) !== 6) throw new Error('Four-car rerace did not create six heats')
const pairs = await page.locator('.schedule-panel .heat-card').evaluateAll(cards => cards.map(card => [...card.querySelectorAll('.lanes strong')].map(node => node.textContent).sort().join('|')))
if (new Set(pairs).size !== 6) throw new Error('Four-car rerace pair repeated')
await page.locator('.schedule-panel .lanes button').first().click()
await page.getByText(/Racing · 1 of 6 heats complete/).first().waitFor()
if (deployed) {
  await page.waitForFunction(() => document.querySelector('.sync')?.textContent?.includes('Saved'), undefined, { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Reraces', exact: true }).click()
  await page.locator('input[value="Tie Racer 1"]').waitFor()
  const adminUrl = new URL(page.url())
  const id = adminUrl.searchParams.get('event')
  const key = new URLSearchParams(adminUrl.hash.slice(1)).get('key')
  const ownerResponse = await fetch(`${baseUrl}/api/events/${id}`, { headers: { 'x-event-key': key } })
  const ownerData = await ownerResponse.json()
  if (!ownerResponse.ok || ownerData.role !== 'owner') throw new Error('Admin event could not be reloaded from Netlify storage')
  if (ownerData.event.payments['shared owner']?.paid !== 30) throw new Error('Fee payment was not saved')
  if (ownerData.event.payments['shared owner']?.prize !== 12.50) throw new Error('Prize was not saved')
  for (const category of ['Stock Advance', 'BMAX Speed']) {
    if (ownerData.event.mainClasses.find(item => item.name === category)?.groups[0].entrants[0].name !== 'Shared Owner') {
      throw new Error(`Entries for ${category} were not saved`)
    }
  }
  const unauthorized = await fetch(`${baseUrl}/api/events/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: ownerData.event, expectedVersion: ownerData.event.version }) })
  if (unauthorized.status !== 401) throw new Error('Public event update was not rejected')
  const viewer = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  const viewerPage = await viewer.newPage()
  await viewerPage.goto(`${baseUrl}/?event=${id}&mode=display`, { waitUntil: 'networkidle' })
  await viewerPage.getByRole('heading', { name: 'Web App Acceptance Race' }).waitFor()
  if (await viewerPage.locator('.main-nav').count()) throw new Error('Public display exposed admin navigation')
  await viewer.close()
}
await page.screenshot({ path: path('rerace-desktop.png'), fullPage: true })

const mobile = await context.newPage()
await mobile.setViewportSize({ width: 390, height: 844 })
await mobile.goto(page.url(), { waitUntil: 'networkidle' })
await mobile.getByRole('button', { name: 'Fees', exact: true }).click()
const mobileFees = mobile.getByRole('region', { name: 'Entry fees by category' })
await mobileFees.waitFor()
await mobile.screenshot({ path: path('fees-mobile.png') })
const mobileLayout = await mobileFees.evaluate(region => {
  region.scrollLeft = region.scrollWidth
  const total = region.querySelector('tfoot tr > :last-child')
  const table = region.getBoundingClientRect()
  return {
    scrolled: region.scrollLeft,
    clippedPixels: total.getBoundingClientRect().right - table.right,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  }
})
if (mobileLayout.scrolled <= 0 || mobileLayout.clippedPixels > 1 || mobileLayout.pageOverflow > 0) {
  throw new Error(`Mobile fee table did not scroll independently: ${JSON.stringify(mobileLayout)}`)
}
await mobile.getByRole('button', { name: 'Reraces', exact: true }).click()
await mobile.getByRole('heading', { name: 'Reraces' }).waitFor()
await mobile.screenshot({ path: path('rerace-mobile.png'), fullPage: true })

const result = { status: 'PASS', baseUrl, deployedStorage: deployed, desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 }, feeRows: 3, sharedOwnerEntries: 6, totalEntries: 8, mainHeats: 8, reraceHeats: 6, uniqueReracePairs: new Set(pairs).size, consoleErrors: errors }
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)
await writeFile(new URL('e2e-result.json', root), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000))])
process.exit(0)
