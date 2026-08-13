import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../single-file/index.html', import.meta.url));
const schedulesPath = fileURLToPath(new URL('../../fixtures/schedules.json', import.meta.url));
const fileUrl = pathToFileURL(htmlPath).href;

async function loadDemo(page: Page) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Race Setup' }).click();
}

function eventWithCars(count: number) {
  const timestamp = '2026-08-13T00:00:00.000Z';
  return {
    version: 1,
    event: { id: `event-${count}`, name: `${count}-car test`, date: '2026-08-13', venue: '', organizer: '', laneCount: 3, status: 'setup', createdAt: timestamp, updatedAt: timestamp, resultSeal: 'draft' },
    settings: { scheduleMode: 'custom', seed: 'initial', rankingMode: 'competition', allowSharedRanks: true, tieBreakOrder: ['totalWins'], finalistCount: 3, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: { standard: 100 } },
    participants: Array.from({ length: count }, (_, index) => ({ id: `person-${index + 1}`, name: `Driver ${index + 1}`, email: '', phone: '', notes: '' })),
    entries: Array.from({ length: count }, (_, index) => ({ id: `entry-${index + 1}`, participantId: `person-${index + 1}`, carNumber: (index + 1) * 10, name: `Car ${index + 1}`, categoryId: 'standard', quantity: 1, active: true })),
    matches: [], finals: [], payments: [], auditLog: [{ id: 'audit-created', timestamp, action: 'event.created', summary: 'Test event created', entityType: 'event', entityId: `event-${count}`, details: {} }],
  };
}

async function importEvent(page: Page, value: unknown) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByLabel('Import event JSON').setInputFiles({ name: 'event.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.getByRole('button', { name: 'Race Setup' }).click();
}

test('maps the exact workbook preset through stable manual slots and gates activation', async ({ page }) => {
  const canonical = JSON.parse(await readFile(schedulesPath, 'utf8')) as Record<string, number[][][]>;
  await loadDemo(page);

  await page.getByLabel('Schedule type').selectOption('template9');
  await expect(page.getByText('9 active cars match this preset.', { exact: true })).toBeVisible();
  expect(await page.locator('[data-schedule-heat]').evaluateAll((rows) => rows.map((row) => JSON.parse(row.getAttribute('data-lanes') ?? '[]')))).toEqual(
    canonical.template9.flat().map((slots) => slots.map((slot) => `car-${String(slot).padStart(2, '0')}`)),
  );

  await page.getByLabel('Slot 1 car').selectOption('car-02');
  await expect(page.getByText(/each active car must be mapped exactly once/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate schedule' })).toBeDisabled();
  await page.getByLabel('Slot 2 car').selectOption('car-01');
  await expect(page.getByText('Valid', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Activate schedule' }).click();

  const state = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  const mapping = ['car-02', 'car-01', ...Array.from({ length: 7 }, (_, index) => `car-${String(index + 3).padStart(2, '0')}`)];
  expect(state.matches.map((heat: any) => heat.lanes)).toEqual(canonical.template9.flat().map((slots) => slots.map((slot) => mapping[slot - 1])));
  expect(state.event.status).toBe('running');
  expect(state.auditLog.at(-1)).toMatchObject({ action: 'schedule.activated' });
});

test('enforces active-count gates for presets before producing a candidate', async ({ page }) => {
  await importEvent(page, eventWithCars(8));
  await page.getByLabel('Schedule type').selectOption('template9');

  await expect(page.locator('#view-content [role="alert"]')).toContainText('9-car preset requires exactly 9 active cars');
  await expect(page.getByRole('button', { name: 'Activate schedule' })).toBeDisabled();
  await expect(page.locator('[data-schedule-heat]')).toHaveCount(0);
});

test('generates deterministic odd-count candidates with truthful quality certificates and balanced lanes', async ({ page }) => {
  await importEvent(page, eventWithCars(7));
  await page.getByLabel('Schedule type').selectOption('custom');
  await page.getByLabel('Schedule seed').fill('odd-count-proof');
  await page.getByLabel('Number of matches').fill('5');
  await page.getByRole('button', { name: 'Generate candidate' }).click();

  const first = await page.locator('[data-schedule-heat]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-lanes')));
  await page.getByRole('button', { name: 'Generate candidate' }).click();
  const second = await page.locator('[data-schedule-heat]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-lanes')));
  expect(second).toEqual(first);
  expect(first.length).toBeGreaterThan(0);

  const quality = await page.locator('[data-quality-report]').evaluate((node) => JSON.parse(node.getAttribute('data-quality-report') ?? '{}'));
  expect(quality.status).not.toBe('invalid');
  expect(quality.appearanceImbalance).toBeLessThanOrEqual(1);
  expect(quality.maximumLaneSpread).toBeLessThanOrEqual(1);
  expect(Object.values(quality.byeCounts).some((count) => Number(count) > 0)).toBe(true);
  for (let match = 1; match <= 5; match += 1) {
    const assigned = (await page.locator(`[data-match-number="${match}"]`).evaluateAll((rows) => rows.flatMap((row) => JSON.parse(row.getAttribute('data-lanes') ?? '[]')).filter(Boolean))) as string[];
    expect(new Set(assigned).size).toBe(assigned.length);
  }

  await expect(page.getByText('Repeat-excess lower bound', { exact: true })).toBeVisible();
  await expect(page.getByText('Repeat-excess gap', { exact: true })).toBeVisible();
  await expect(page.getByText('Maximum pair-frequency lower bound', { exact: true })).toBeVisible();
  await expect(page.getByText('Maximum pair-frequency gap', { exact: true })).toBeVisible();
  await expect(page.getByText(/certified optimal for the repeat-excess lower bound|best found/i)).toBeVisible();
  await expect(page.getByText(/bye assignment/i)).toBeVisible();

  await page.getByRole('button', { name: 'Activate schedule' }).click();
  const state = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(state.matches).toHaveLength(first.length);
  expect(state.settings).toMatchObject({ scheduleMode: 'custom', seed: 'odd-count-proof' });
});
