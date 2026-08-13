import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../single-file/index.html', import.meta.url));
const fixturePath = fileURLToPath(new URL('../../fixtures/demo-event.json', import.meta.url));
const fileUrl = pathToFileURL(htmlPath).href;
let server: Server;
let httpUrl: string;

test.beforeAll(async () => {
  const html = await readFile(htmlPath);
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server failed to start');
  httpUrl = `http://127.0.0.1:${address.port}/`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function loadDemo(page: Parameters<typeof test>[0]['page'], url = httpUrl) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await expect(page.getByText('Demo event', { exact: true })).toBeVisible();
}

async function importEvent(page: Parameters<typeof test>[0]['page'], value: unknown, name = 'event.json') {
  await page.getByLabel('Import event JSON').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
}

async function downloadText(page: Parameters<typeof test>[0]['page'], buttonName: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('round-trips the canonical schema-v1 fixture and allows an empty payment note', async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { payments: Array<{ note: string }> };
  fixture.payments[0]!.note = '';
  await page.goto(httpUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await importEvent(page, fixture);
  await expect(page.getByText('Nine-Car Community Demo', { exact: true }).first()).toBeVisible();
  const exported = JSON.parse(await downloadText(page, 'Download event JSON'));
  expect(exported).toEqual(fixture);
});

test('rejects strict-schema enum, heat consistency, time, phase, and extra-key violations atomically', async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, any>;
  await page.goto(httpUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await importEvent(page, fixture, 'baseline.json');
  const before = await page.evaluate(() => JSON.stringify((window as unknown as { RR3: { getState(): unknown } }).RR3.getState()));
  const cases: Array<[string, (value: Record<string, any>) => void]> = [
    ['extra root key', (value) => { value.unexpected = true; }],
    ['invalid setting enum', (value) => { value.settings.rankingMode = 'alphabetical'; }],
    ['wrong collection phase', (value) => { value.matches[0].phase = 'final'; }],
    ['completed heat without winner', (value) => { value.matches[0].winnerEntryId = null; }],
    ['non-completed heat with winner', (value) => { value.matches[5].winnerEntryId = 'car-03'; }],
    ['negative lane time', (value) => { value.matches[0].laneTimesMs[0] = -1; }],
  ];
  for (const [label, mutate] of cases) {
    const invalid = structuredClone(fixture);
    mutate(invalid);
    await importEvent(page, invalid, `${label}.json`);
    await expect(page.locator('.notice.error')).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify((window as unknown as { RR3: { getState(): unknown } }).RR3.getState())), label).toBe(before);
  }
});

test('rejects accounting overflow before import can replace or render the current event', async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, any>;
  await page.goto(httpUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await importEvent(page, fixture, 'baseline.json');
  const before = await page.evaluate(() => JSON.stringify((window as unknown as { RR3: { getState(): unknown } }).RR3.getState()));
  const overflow = structuredClone(fixture);
  overflow.settings.prices.standard = Number.MAX_SAFE_INTEGER;
  overflow.entries[0].quantity = 2;
  await importEvent(page, overflow, 'overflow.json');
  await expect(page.locator('.notice.error')).toContainText(/safe integer|overflow/i);
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { RR3: { getState(): unknown } }).RR3.getState()))).toBe(before);
});

test('keeps a reloadable demo workspace separate from official current and previous saves', async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, any>;
  fixture.event.name = 'Official Saved Derby';
  await page.goto(httpUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await importEvent(page, fixture, 'official.json');
  await expect(page.getByTestId('save-confidence')).toContainText('Saved locally');
  const official = await page.evaluate(() => ({ current: localStorage.getItem('rr3:solo:event:current'), previous: localStorage.getItem('rr3:solo:event:previous') }));

  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  expect(await page.evaluate(() => ({ current: localStorage.getItem('rr3:solo:event:current'), previous: localStorage.getItem('rr3:solo:event:previous') }))).toEqual(official);
  await page.reload();
  await expect(page.getByText('Demo event', { exact: true })).toBeVisible();
  await expect(page.getByText('Nine-Car Community Demo', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => ({ current: localStorage.getItem('rr3:solo:event:current'), previous: localStorage.getItem('rr3:solo:event:previous') }))).toEqual(official);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Return to official event' }).click();
  await expect(page.getByText('Official Saved Derby', { exact: true }).first()).toBeVisible();
});

test('matches shared CSV builders row for row with deterministic full columns', async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, any>;
  fixture.participants = [
    { id: 'participant-z', name: 'Zoë', email: 'z@example.test', phone: '1', notes: '' },
    { id: 'participant-a', name: 'Ada', email: '', phone: '', notes: '' },
  ];
  fixture.entries = [
    { id: 'car-z', participantId: 'participant-z', carNumber: 2, name: 'Bolt', categoryId: 'standard', quantity: 1, active: true },
    { id: 'car-a', participantId: 'participant-a', carNumber: 1, name: 'Arrow', categoryId: 'standard', quantity: 2, active: true },
  ];
  fixture.matches = [{ id: 'heat-z', phase: 'preliminary', matchNumber: 1, heatNumber: 1, lanes: ['car-z', 'car-a', null], status: 'completed', winnerEntryId: 'car-z', laneTimesMs: [1200, 1300, null], notes: 'Go, "now"' }];
  fixture.finals = [];
  fixture.payments = [{ id: 'payment-z', participantId: 'participant-z', amountCents: 1200, kind: 'payment', paidAt: '2026-08-13T01:30:00.000Z', note: '' }];
  fixture.auditLog = [
    { id: 'audit-z', timestamp: '2026-08-13T01:00:00.000Z', action: 'z', summary: 'Later ID', entityType: 'event', entityId: fixture.event.id, details: { z: 1, a: 2 } },
    { id: 'audit-a', timestamp: '2026-08-13T01:00:00.000Z', action: 'a', summary: 'Earlier ID', entityType: 'event', entityId: fixture.event.id, details: {} },
  ];
  fixture.settings.tieBreakOrder = ['totalWins'];
  await page.goto(httpUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await importEvent(page, fixture);

  expect(await downloadText(page, 'Download Participant registration CSV')).toBe([
    'Participant ID,Participant,Email,Phone,Car entry ID,Car number,Car,Category,Quantity,Active',
    'participant-a,Ada,,,car-a,1,Arrow,standard,2,true',
    'participant-z,Zoë,z@example.test,1,car-z,2,Bolt,standard,1,true',
  ].join('\r\n'));
  expect(await downloadText(page, 'Download Accounts CSV')).toBe([
    'Participant ID,Participant,Charge cents,Collected cents,Balance cents',
    'participant-z,Zoë,1200,1200,0',
    'participant-a,Ada,2400,0,2400',
  ].join('\r\n'));
  expect(await downloadText(page, 'Download Schedule and results CSV')).toBe([
    'Heat ID,Phase,Match,Heat,Lane 1,Lane 2,Lane 3,Status,Winner entry ID,Lane 1 time ms,Lane 2 time ms,Lane 3 time ms,Notes',
    'heat-z,preliminary,1,1,car-z,car-a,,completed,car-z,1200,1300,,"Go, ""now"""',
  ].join('\r\n'));
  expect(await downloadText(page, 'Download Standings CSV')).toBe([
    'Rank,Tied,Car entry ID,Car number,Car,Participant ID,Participant,Category,Total wins,Matches won,Completed heats,Average time ms,Best time ms',
    '1,false,car-z,2,Bolt,participant-z,Zoë,standard,1,1,1,1200,1200',
    '2,false,car-a,1,Arrow,participant-a,Ada,standard,0,0,1,1300,1300',
  ].join('\r\n'));
  expect(await downloadText(page, 'Download Audit CSV')).toBe([
    'Audit ID,Timestamp,Action,Summary,Entity type,Entity ID,Details JSON',
    `audit-a,2026-08-13T01:00:00.000Z,a,Earlier ID,event,${fixture.event.id},{}`,
    `audit-z,2026-08-13T01:00:00.000Z,z,Later ID,event,${fixture.event.id},"{""a"":2,""z"":1}"`,
  ].join('\r\n'));
});

test('keeps current and previous valid saves, reloads, and restores the prior snapshot', async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, any>;
  await page.goto(httpUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await importEvent(page, fixture, 'official.json');
  await expect(page.getByTestId('save-confidence')).toContainText('Saved locally');
  const initialName = await page.evaluate(() => (window as unknown as { RR3: { getState(): { event: { name: string } } } }).RR3.getState().event.name);

  await page.getByRole('button', { name: 'Race Setup' }).click();
  await page.getByLabel('Event name').fill('First saved name');
  await page.getByRole('button', { name: 'Save event details' }).click();
  await expect(page.getByTestId('save-confidence')).toContainText('Saved locally');
  await page.getByLabel('Event name').fill('Second saved name');
  await page.getByRole('button', { name: 'Save event details' }).click();
  await expect(page.getByTestId('save-confidence')).toContainText('Saved locally');

  const keys = await page.evaluate(() => ({
    current: localStorage.getItem('rr3:solo:event:current'),
    previous: localStorage.getItem('rr3:solo:event:previous'),
  }));
  expect(keys.current).toContain('Second saved name');
  expect(keys.previous).toContain('First saved name');

  await page.reload();
  await expect(page.getByText('Second saved name', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Restore previous save' }).click();
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.getByText('First saved name', { exact: true }).first()).toBeVisible();
  const rotated = await page.evaluate(() => ({
    current: localStorage.getItem('rr3:solo:event:current'),
    previous: localStorage.getItem('rr3:solo:event:previous'),
  }));
  expect(rotated.current).toContain('First saved name');
  expect(rotated.previous).toContain('Second saved name');
  await page.getByRole('button', { name: 'Restore previous save' }).click();
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.getByText('Second saved name', { exact: true }).first()).toBeVisible();
  expect(initialName).toBe('Nine-Car Community Demo');
});

test('Escape closes a confirmation dialog and restores focus to its trigger', async ({ page }) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  await page.goto(httpUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await importEvent(page, fixture);
  await page.getByRole('button', { name: 'Settings' }).click();
  const reset = page.getByRole('button', { name: 'Reset event' });
  await reset.focus();
  await reset.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(reset).toBeFocused();
});

test('imports atomically, rejects unsafe input, and preserves stable IDs', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Reports' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download event JSON' }).click();
  const exported = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of exported) chunks.push(Buffer.from(chunk));
  const json = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(json) as { event: { name: string }, entries: Array<{ id: string }> };
  parsed.event.name = 'Imported Derby';
  const expectedIds = parsed.entries.map(({ id }) => id);

  await page.getByLabel('Import event JSON').setInputFiles({ name: 'event.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(parsed)) });
  await expect(page.getByText('Imported Derby', { exact: true }).first()).toBeVisible();
  expect((await page.evaluate(() => (window as unknown as { RR3: { getState(): { entries: Array<{ id: string }> } } }).RR3.getState().entries.map(({ id }) => id)))).toEqual(expectedIds);

  const before = await page.evaluate(() => JSON.stringify((window as unknown as { RR3: { getState(): unknown } }).RR3.getState()));
  const unsafeEvent = JSON.parse(json) as { auditLog: Array<{ details: unknown }> };
  unsafeEvent.auditLog[0]!.details = JSON.parse('{"__proto__":{"polluted":true}}');
  const unsafe = JSON.stringify(unsafeEvent);
  await page.getByLabel('Import event JSON').setInputFiles({ name: 'unsafe.json', mimeType: 'application/json', buffer: Buffer.from(unsafe) });
  await expect(page.getByText(/unsafe object key/i)).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { RR3: { getState(): unknown } }).RR3.getState()))).toBe(before);
  expect(await page.evaluate(() => ({} as { polluted?: boolean }).polluted)).toBeUndefined();
});

test('downloads five CRLF CSV reports and neutralizes formula-capable text', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Registration' }).click();
  await page.getByLabel('Participant name').fill('  =HYPERLINK("x")');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await page.getByRole('button', { name: 'Reports' }).click();

  const buttons = ['Participant registration CSV', 'Accounts CSV', 'Schedule and results CSV', 'Standings CSV', 'Audit CSV'];
  for (const name of buttons) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${name}` }).click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain('\r\n');
    expect(csv).not.toMatch(/(?<!')(^|,)\s*[=+\-@]/m);
  }
});

test('warns file-URL users to download a durable backup after meaningful changes', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  const warning = page.locator('.notice[role="alert"]');
  await expect(warning).toContainText('Download an event JSON backup');
  await expect(warning).toContainText('file storage is best effort');
});

test('guards a reset and returns to an empty official event', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Reset event' }).click();
  await expect(page.getByRole('dialog')).toContainText('official saves remain untouched');
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(page.getByText('No event loaded', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('rr3:solo:event:current'))).toBeNull();
});
