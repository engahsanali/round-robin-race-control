import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { executablePath } from './browser.mjs'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173'
const profile = await mkdtemp(join(tmpdir(), 'rr-recovery-'))
const eventName = 'Browser recovery test'
const errors = []
let browser
let event
let denyWrites = false
let conflicts = 0

async function startBrowser() {
  browser = await chromium.launchPersistentContext(profile, { executablePath, headless: true, serviceWorkers: 'block' })
  await browser.route('**/api/events**', async route => {
    const request = route.request()
    const method = request.method()
    if (method === 'POST') {
      event = { ...request.postDataJSON().event, id: 'recovery-test', version: 1 }
      return route.fulfill({ status: 201, json: { event, ownerKey: 'browser-recovery-fixture' } })
    }
    if (method === 'GET') return route.fulfill({ json: { event, role: 'owner' } })
    if (denyWrites) return route.abort()

    const body = request.postDataJSON()
    if (body.group) {
      const group = event.mainClasses.flatMap(cls => cls.groups).find(group => group.id === body.group.id)
      if (group.revision !== body.expectedRevision) {
        conflicts++
        return route.fulfill({ status: 409, json: { group, audit: [] } })
      }
      Object.assign(group, body.group, { revision: group.revision + 1 })
      return route.fulfill({ json: { group, audit: body.audit } })
    }
    assert.equal(body.expectedVersion, event.version)
    event = { ...event, version: event.version + 1, payments: body.event.payments, audit: body.event.audit }
    return route.fulfill({ json: { event } })
  })
  const page = browser.pages()[0]
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(baseUrl)
  return page
}

const button = (page, name) => page.getByRole('button', { name, exact: true })
const resume = page => page.getByRole('button', { name: new RegExp('Resume edits for ' + eventName) })
const waitForSaved = page => page.locator('.sync-saved').waitFor()
const firstEntrant = (page, field) => page.getByLabel('Competitor 1 ' + field)

try {
  let page = await startBrowser()
  await page.getByLabel('Event name').fill(eventName)
  await button(page, 'Create event').click()
  await button(page, 'Entries').click()
  await firstEntrant(page, 'name').fill('Racer One')
  await firstEntrant(page, 'car number').fill('1')
  await waitForSaved(page)
  const [bracketA, bracketB] = event.mainClasses[0].groups
  assert.equal(bracketA.entrants[0].name, 'Racer One')

  // The organiser closes the whole browser with two changes still pending.
  denyWrites = true
  await firstEntrant(page, 'car number').fill('8')
  await button(page, 'Fees').click()
  await page.getByLabel('Prize for Racer One').fill('4.25')
  await browser.close()
  Object.assign(bracketB.entrants[0], { name: 'Racer Two', carNumber: '2' })
  bracketB.revision++
  denyWrites = false

  page = await startBrowser()
  await resume(page).click()
  await button(page, 'Entries').click()
  assert.equal(await firstEntrant(page, 'car number').inputValue(), '8')
  await button(page, 'Bracket B').click()
  assert.equal(await firstEntrant(page, 'name').inputValue(), 'Racer Two')
  await waitForSaved(page)
  assert.equal(bracketA.entrants[0].carNumber, '8')
  assert.equal(event.payments['racer one'].prize, 4.25)
  await button(page, 'Return to events').click()
  assert.equal(await resume(page).count(), 0)
  await page.getByRole('button', { name: new RegExp(eventName) }).click()

  // A different save to the same bracket requires an explicit choice on recovery.
  await button(page, 'Entries').click()
  denyWrites = true
  await firstEntrant(page, 'car number').fill('9')
  await browser.close()
  bracketA.entrants[0].carNumber = '7'
  bracketA.revision++
  denyWrites = false

  page = await startBrowser()
  await resume(page).click()
  await button(page, 'Use saved bracket').waitFor()
  assert.equal(conflicts, 1)
  assert.equal(bracketA.entrants[0].carNumber, '7')
  await button(page, 'Use saved bracket').click()
  await button(page, 'Entries').click()
  assert.equal(await firstEntrant(page, 'car number').inputValue(), '7')
  await button(page, 'Return to events').click()
  assert.equal(await resume(page).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: browser restart, recent event access, pending roster and prize recovery, independent bracket merge, and stale bracket conflict')
} finally {
  await browser?.close().catch(() => {})
  if (dirname(resolve(profile)) === resolve(tmpdir())) await rm(profile, { recursive: true, force: true })
}
