import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../single-file/index.html', import.meta.url));
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

test('keeps current and previous valid saves, reloads, and restores the prior snapshot', async ({ page }) => {
  await loadDemo(page);
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
  expect(initialName).toBe('Nine-Car Community Demo');
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
  await expect(page.getByRole('dialog')).toContainText('cannot be undone without a downloaded backup');
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(page.getByText('No event loaded', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('rr3:solo:event:current'))).toBeNull();
});
