import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { executablePath } from './browser.mjs'

const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const artifacts = new URL('../artifacts/', import.meta.url)
const screenshots = new URL('../docs/screenshots/', import.meta.url)
await Promise.all([mkdir(artifacts, { recursive: true }), mkdir(screenshots, { recursive: true })])
const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text())
})

// This regression checks the rendered production UI with an isolated in-memory
// event API. It never creates or changes a real race or its stored results.
let fixture
await context.route('**/api/events**', async route => {
  const request = route.request()
  let body
  if (request.method() === 'POST') {
    body = request.postDataJSON()
    fixture = { ...body.event, id: 'layout-regression', version: 1 }
    return route.fulfill({ json: { event: fixture, ownerKey: 'layout-fixture-only' } })
  }
  if (request.method() === 'PUT') {
    body = request.postDataJSON()
    if (body.group) {
      const group = { ...body.group, revision: (body.expectedRevision ?? 0) + 1 }
      const replace = groups => groups.map(item => item.id === group.id ? group : item)
      fixture.mainClasses = fixture.mainClasses.map(item => ({ ...item, groups: replace(item.groups) }))
      fixture.finalsClasses = fixture.finalsClasses.map(item => ({ ...item, groups: replace(item.groups) }))
      fixture.reraces = replace(fixture.reraces)
      fixture.audit = [...fixture.audit.filter(item => item.groupId !== group.id), ...body.audit]
      return route.fulfill({ json: { group, audit: body.audit } })
    }
    fixture = { ...body.event, version: fixture.version + 1 }
    return route.fulfill({ json: { event: fixture } })
  }
  return route.fulfill({ json: { event: fixture, role: request.headers()['x-event-key'] ? 'owner' : 'viewer' } })
})

try {
  await page.goto(baseUrl)
  await page.getByLabel('Event name').fill('Standings layout regression')
  await page.getByRole('button', { name: 'Create event' }).click()
  await page.getByRole('button', { name: 'Entries', exact: true }).click()
  for (let i = 1; i <= 21; i++) {
    await page.getByLabel(`Competitor ${i} name`).fill(`Test Racer ${i}`)
    await page.getByLabel(`Competitor ${i} car number`).fill(String(i))
  }
  await page.getByText('Saved', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Race day', exact: true }).click()
  const table = page.locator('.standings-table')
  const panel = page.getByRole('complementary', { name: 'Live standings' })
  const heats = page.locator('.heat-card')
  assert.equal(await table.locator(':scope > div').count(), 22)
  const results = []
  for (const [width, height] of [[1440, 1000], [1100, 800], [1024, 768], [390, 844], [320, 640], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await heats.last().scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
    const rect = await panel.boundingBox()
    const chrome = await page.locator('.main-nav').boundingBox()
    assert(rect.y >= chrome.y + chrome.height, `${width}: standings overlaps navigation`)
    assert(rect.y < chrome.y + chrome.height + 20, `${width}: standings is not pinned while scoring the last round`)
    assert(rect.y + rect.height <= height, `${width}: standings extends below viewport`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: horizontal page overflow`)
    await table.evaluate(element => { element.scrollTop = element.scrollHeight })
    const lastRow = await table.locator(':scope > div').last().boundingBox()
    const tableRect = await table.boundingBox()
    assert(lastRow.y + lastRow.height <= tableRect.y + tableRect.height + 1, `${width}: last competitor inaccessible`)
    const headingRect = await page.locator('.standings-head').boundingBox()
    assert(Math.abs(headingRect.y - tableRect.y) < 2, `${width}: standings heading is not pinned`)
    await table.evaluate(element => { element.scrollTop = 0 })
    if (width === 1440 || width === 390) {
      await page.screenshot({ path: fileURLToPath(new URL(`v${version}-standings-${width === 1440 ? 'desktop' : 'mobile'}.png`, screenshots)) })
    }
    if (width <= 1050) {
      await panel.getByRole('button', { name: 'Collapse', exact: true }).click()
      assert.equal(await table.isVisible(), false)
      const toggle = panel.getByRole('button', { name: 'Expand', exact: true })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      await toggle.focus()
      await page.keyboard.press('Enter')
      assert.equal(await table.isVisible(), true)
    }
    results.push({ width, height, pinned: true, allCompetitorsAccessible: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const lastWinner = heats.last().locator('.lanes button').first()
  const before = await table.textContent()
  await lastWinner.click()
  await page.getByText('Saved', { exact: true }).waitFor()
  assert((await lastWinner.getAttribute('class')).includes('winner'))
  assert.notEqual(await table.textContent(), before, 'Scoring does not update pinned standings')
  await lastWinner.click()
  await page.getByText('Saved', { exact: true }).waitFor()
  assert.equal(await table.textContent(), before, 'Clearing a winner does not restore standings')
  await panel.getByRole('button', { name: 'Collapse', exact: true }).click()
  await page.emulateMedia({ media: 'print' })
  assert.equal(await table.isVisible(), true, 'Collapsed standings missing from print')
  await page.emulateMedia({ media: 'screen' })
  const id = new URL(page.url()).searchParams.get('event')
  await page.goto(`${baseUrl}/?event=${id}&mode=display`)
  await page.locator('.heat-card').last().scrollIntoViewIfNeeded()
  const displayRect = await panel.boundingBox()
  const headerRect = await page.locator('.topbar').boundingBox()
  assert(displayRect.y >= headerRect.height && displayRect.y < headerRect.height + 20, 'Public display pinned offset is incorrect')
  assert.equal(await page.locator('.main-nav').count(), 0)
  assert.equal(await page.locator('.lanes button:enabled').count(), 0)
  assert.deepEqual(errors, [])
  const result = { status: 'PASS', baseUrl, isolatedApi: true, viewports: results, scoreAndClear: true, keyboardToggle: true, print: true, publicDisplay: true, consoleErrors: errors }
  await writeFile(new URL('standings-result.json', artifacts), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
