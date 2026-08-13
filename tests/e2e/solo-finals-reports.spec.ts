import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../single-file/index.html', import.meta.url));
const schedulesPath = fileURLToPath(new URL('../../fixtures/schedules.json', import.meta.url));
const fileUrl = pathToFileURL(htmlPath).href;

function finalsEvent(count = 4, finalistCount = 2) {
  const timestamp = '2026-08-14T00:00:00.000Z';
  const participants = Array.from({ length: count }, (_, index) => ({ id: `person-${index + 1}`, name: `Driver ${index + 1}`, email: '', phone: '', notes: '' }));
  const entries = participants.map((participant, index) => ({ id: `car-${index + 1}`, participantId: participant.id, carNumber: index + 1, name: `Finalist ${index + 1}`, categoryId: 'open', quantity: 1, active: true }));
  const matches = count === 15
    ? Array.from({ length: 5 }, (_, index) => ({ id: `pre-${index + 1}`, phase: 'preliminary', matchNumber: 1, heatNumber: index + 1, lanes: [`car-${index * 3 + 1}`, `car-${index * 3 + 2}`, `car-${index * 3 + 3}`], status: 'completed', winnerEntryId: `car-${index * 3 + 1}`, laneTimesMs: [900 + index, 1000 + index, 1100 + index], notes: '' }))
    : [
      { id: 'pre-1', phase: 'preliminary', matchNumber: 1, heatNumber: 1, lanes: ['car-1', 'car-2', 'car-3'], status: 'completed', winnerEntryId: 'car-1', laneTimesMs: [900, 1000, 1050], notes: '' },
      { id: 'pre-2', phase: 'preliminary', matchNumber: 2, heatNumber: 1, lanes: ['car-1', 'car-2', 'car-4'], status: 'completed', winnerEntryId: 'car-1', laneTimesMs: [890, 1010, 1080], notes: '' },
      { id: 'pre-3', phase: 'preliminary', matchNumber: 3, heatNumber: 1, lanes: ['car-2', 'car-3', 'car-4'], status: 'completed', winnerEntryId: 'car-2', laneTimesMs: [980, 1020, 1070], notes: '' },
      { id: 'pre-4', phase: 'preliminary', matchNumber: 4, heatNumber: 1, lanes: ['car-2', 'car-3', 'car-4'], status: 'completed', winnerEntryId: 'car-3', laneTimesMs: [990, 970, 1060], notes: '' },
    ];
  return {
    version: 1,
    event: { id: 'event-finals', name: 'Finals Night', date: '2026-08-14', venue: 'RR Hall', organizer: 'Race Crew', laneCount: 3, status: 'running', createdAt: timestamp, updatedAt: timestamp, resultSeal: 'provisional' },
    settings: { scheduleMode: 'custom', seed: 'finals-proof', rankingMode: 'competition', allowSharedRanks: true, tieBreakOrder: count === 15 ? ['totalWins', 'carNumber'] : ['totalWins'], finalistCount, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: { open: 1000 } },
    participants, entries, matches, finals: [], payments: [], auditLog: [],
  };
}

async function importEvent(page: Page, value: unknown) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByLabel('Import event JSON').setInputFiles({ name: 'finals.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

async function openFinals(page: Page, value: unknown) {
  await importEvent(page, value);
  await page.getByRole('button', { name: 'Finals' }).click();
}

test('surfaces a tied qualification cutoff and supports include-all, playoff, and reasoned manual resolution', async ({ page }) => {
  await openFinals(page, finalsEvent());
  await expect(page.getByText('2 places requested · 2 cars tied across the cutoff', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Include all tied cars' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate qualification playoff' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manual selection with reason' })).toBeVisible();

  await page.getByRole('button', { name: 'Manual selection with reason' }).click();
  await page.getByRole('button', { name: 'Confirm manual finalists' }).click();
  await expect(page.getByLabel('Manual qualification reason')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Manual cutoff qualifier').selectOption('car-3');
  await page.getByLabel('Manual qualification reason').fill('Race director reviewed the finish evidence');
  await page.getByRole('button', { name: 'Confirm manual finalists' }).click();
  await expect(page.getByRole('list', { name: 'Selected finalists' })).toContainText('Finalist 1');
  await expect(page.getByRole('list', { name: 'Selected finalists' })).toContainText('Finalist 3');
  expect(await page.evaluate(() => (window as any).RR3.getState())).toMatchObject({ auditLog: expect.arrayContaining([expect.objectContaining({ action: 'finals.manual-qualified', details: expect.objectContaining({ reason: 'Race director reviewed the finish evidence' }) })]) });

  await openFinals(page, finalsEvent());
  await page.getByRole('button', { name: 'Generate qualification playoff' }).click();
  const playoff = await page.evaluate(() => (window as any).RR3.getState());
  expect(playoff.finals).toHaveLength(1);
  expect(playoff.finals[0]).toMatchObject({ phase: 'final', lanes: ['car-2', 'car-3', null], status: 'scheduled', notes: 'Qualification playoff' });

  await openFinals(page, finalsEvent());
  await page.getByRole('button', { name: 'Include all tied cars' }).click();
  await expect(page.getByRole('list', { name: 'Selected finalists' }).getByRole('listitem')).toHaveCount(3);
});

test('maps all fifteen finalists through the fixed workbook preset and uses balanced custom finals otherwise', async ({ page }) => {
  const canonical = JSON.parse(await readFile(schedulesPath, 'utf8')) as Record<string, number[][][]>;
  await openFinals(page, finalsEvent(15, 15));
  await page.getByRole('button', { name: 'Generate finals schedule' }).click();
  let state = await page.evaluate(() => (window as any).RR3.getState());
  expect(state.finals.map((heat: any) => heat.lanes)).toEqual(canonical.finals15.flat().map((slots) => slots.map((slot) => `car-${slot}`)));
  expect(state.finals.every((heat: any) => heat.phase === 'final')).toBe(true);

  await openFinals(page, finalsEvent(4, 3));
  await page.getByRole('button', { name: 'Generate finals schedule' }).click();
  state = await page.evaluate(() => (window as any).RR3.getState());
  expect(state.finals.length).toBeGreaterThan(0);
  expect(new Set(state.finals.flatMap((heat: any) => heat.lanes.filter(Boolean)))).toEqual(new Set(['car-1', 'car-2', 'car-3']));
  await expect(page.getByRole('table', { name: 'Finals standings' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Finals standings' })).not.toContainText('2 wins');

  const preliminary = structuredClone(state.matches);
  await page.getByRole('button', { name: 'Reset finals only' }).click();
  await page.getByLabel('Finals reset reason').fill('Rebuild after lane maintenance');
  await page.getByRole('button', { name: 'Confirm finals reset' }).click();
  state = await page.evaluate(() => (window as any).RR3.getState());
  expect(state.finals).toEqual([]);
  expect(state.matches).toEqual(preliminary);
});

test('guards the champion and official seal until finals complete or a reasoned manual decision is audited', async ({ page }) => {
  const event = finalsEvent(4, 3) as any;
  event.finals = [{ id: 'final-1', phase: 'final', matchNumber: 1, heatNumber: 1, lanes: ['car-1', 'car-2', 'car-3'], status: 'scheduled', winnerEntryId: null, laneTimesMs: [null, null, null], notes: '' }];
  await openFinals(page, event);
  await expect(page.getByText('Champion pending valid finals completion.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Seal official results' })).toBeDisabled();
  await expect(page.locator('[data-official-champion]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Manual champion decision' }).click();
  await page.getByRole('button', { name: 'Confirm manual champion' }).click();
  await expect(page.getByLabel('Manual champion reason')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Manual champion', { exact: true }).selectOption('car-2');
  await page.getByLabel('Manual champion reason').fill('Finals abandoned after verified track failure');
  await page.getByRole('button', { name: 'Confirm manual champion' }).click();
  await expect(page.getByRole('button', { name: 'Seal official results' })).toBeEnabled();
  await page.getByRole('button', { name: 'Seal official results' }).click();
  await expect(page.locator('[data-official-champion]')).toContainText('Finalist 2');
  await expect(page.getByText('Official seal', { exact: true })).toBeVisible();
  const sealed = await page.evaluate(() => (window as any).RR3.getState());
  expect(sealed.event.resultSeal).toBe('official');
  expect(sealed.auditLog.map((entry: any) => entry.action)).toEqual(expect.arrayContaining(['champion.manual-decided', 'results.sealed']));
});

test('offers print routes whose controls disappear in print and creates a credited Canvas share card', async ({ page }) => {
  await importEvent(page, finalsEvent());
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.locator('#print-layout option')).toHaveText(['Registration', 'Payments', 'Schedule & cards', 'Standings', 'Podium', 'Finals', 'Audit']);
  await page.locator('#print-layout').selectOption('podium');
  await page.getByRole('button', { name: 'Prepare print layout' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-route', 'podium');
  await expect(page.getByRole('region', { name: 'Podium print layout' })).toContainText('Made by Cesar Lacsamana and Ahsan Ali');

  const share = page.getByRole('region', { name: 'Share card studio' });
  await expect(share.locator('canvas')).toHaveAttribute('data-share-credit', 'Made by Cesar Lacsamana and Ahsan Ali');
  expect(await share.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height, png: canvas.toDataURL().startsWith('data:image/png') }))).toEqual({ width: 1200, height: 630, png: true });
  await expect(page.getByRole('button', { name: 'Download share card' })).toBeVisible();
  const hasNativeShare = await page.evaluate(() => typeof navigator.share === 'function');
  await expect(page.getByRole('button', { name: 'Share results' })).toHaveCount(hasNativeShare ? 1 : 0);

  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('[data-print-controls]').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).display === 'none'))).toBe(true);
  await expect(page.locator('[data-share-controls]')).toHaveCSS('display', 'none');
});

test('ships as one dependency-free runtime HTML document', async () => {
  const html = await readFile(htmlPath, 'utf8');
  expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
  expect(html).not.toMatch(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i);
  expect(html).not.toMatch(/<(?:script|img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']https?:/i);
  expect(html).not.toMatch(/url\(\s*["']?https?:/i);
});
