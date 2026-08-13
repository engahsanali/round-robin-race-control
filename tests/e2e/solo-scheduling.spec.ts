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

async function candidateLanes(page: Page) {
  return page.locator('[data-schedule-heat]').evaluateAll((rows) => rows.map((row) => JSON.parse(row.getAttribute('data-lanes') ?? '[]')));
}

test('previews every preliminary workbook preset exactly and keeps the finals preset inert', async ({ page }) => {
  const canonical = JSON.parse(await readFile(schedulesPath, 'utf8')) as Record<string, number[][][]>;
  for (const [mode, count] of [['template9', 9], ['template12', 12], ['template15', 15]] as const) {
    await importEvent(page, eventWithCars(count));
    await page.getByLabel('Schedule type').selectOption(mode);
    expect(await candidateLanes(page), mode).toEqual(canonical[mode].flat().map((slots) => slots.map((slot) => `entry-${slot}`)));
  }

  expect(JSON.parse(await page.locator('#preset-data').textContent() ?? '{}').finals15).toEqual(canonical.finals15);
  await expect(page.getByLabel('Schedule type').locator('option[value="finals15"]')).toHaveCount(0);
});

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

test('enforces every preliminary preset active-count gate before producing a candidate', async ({ page }) => {
  for (const [mode, required] of [['template9', 9], ['template12', 12], ['template15', 15]] as const) {
    await importEvent(page, eventWithCars(required - 1));
    await page.getByLabel('Schedule type').selectOption(mode);
    await expect(page.locator('#view-content [role="alert"]')).toContainText(`${required}-car preset requires exactly ${required} active cars`);
    await expect(page.getByRole('button', { name: 'Activate schedule' })).toBeDisabled();
    await expect(page.locator('[data-schedule-heat]')).toHaveCount(0);
  }
});

test('requires a reasoned destructive confirmation and recoverable snapshot before replacing results', async ({ page }) => {
  const original = eventWithCars(9);
  original.event.status = 'running';
  original.matches = [{ id: 'old-result', phase: 'preliminary', matchNumber: 1, heatNumber: 1, lanes: ['entry-1', 'entry-2', 'entry-3'], status: 'completed', winnerEntryId: 'entry-2', laneTimesMs: [1250, 1190, 1310], notes: 'Official result' }];
  await importEvent(page, original);
  await expect(page.getByTestId('save-confidence')).toContainText('Saved locally');
  await page.getByLabel('Schedule type').selectOption('template9');
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  const activate = page.getByRole('button', { name: 'Activate schedule' });

  await activate.click();
  await expect(page.getByRole('dialog')).toContainText('1 completed, cancelled, or rerun heat');
  expect((await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState())).matches).toEqual(before.matches);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(activate).toBeFocused();
  expect((await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState())).matches).toEqual(before.matches);

  await activate.click();
  await page.getByRole('dialog').press('Escape');
  await expect(activate).toBeFocused();
  expect((await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState())).matches).toEqual(before.matches);

  await activate.click();
  await page.getByLabel('Schedule replacement reason').fill('Storage failure proof');
  await page.evaluate(() => {
    const runtime = window as unknown as { originalStorageSetItem?: Storage['setItem'] };
    runtime.originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'rr3:solo:event:previous') throw new Error('simulated storage failure');
      return runtime.originalStorageSetItem!.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Confirm schedule replacement' }).click();
  expect((await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState())).matches).toEqual(before.matches);
  await expect(page.getByRole('dialog')).toContainText('previous valid snapshot could not be saved');
  await page.evaluate(() => {
    const runtime = window as unknown as { originalStorageSetItem?: Storage['setItem'] };
    Storage.prototype.setItem = runtime.originalStorageSetItem!;
    delete runtime.originalStorageSetItem;
  });
  await page.getByRole('button', { name: 'Cancel' }).click();

  await activate.click();
  await page.getByRole('button', { name: 'Confirm schedule replacement' }).click();
  await expect(page.getByLabel('Schedule replacement reason')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Schedule replacement reason').fill('Director approved revised draw');
  await page.getByRole('button', { name: 'Confirm schedule replacement' }).click();

  const after = await page.evaluate(() => ({
    state: (window as unknown as { RR3: { getState(): any } }).RR3.getState(),
    previous: JSON.parse(localStorage.getItem('rr3:solo:event:previous') ?? 'null'),
  }));
  expect(after.previous.matches).toEqual(before.matches);
  expect(after.state.matches).not.toEqual(before.matches);
  expect(after.state.auditLog.at(-1)).toMatchObject({
    action: 'schedule.replaced',
    details: {
      reason: 'Director approved revised draw',
      beforeSummary: { heatCount: 1, affectedStatusCount: 1, completedCount: 1, cancelledCount: 0, rerunCount: 0 },
      beforeSchedule: before.matches,
    },
  });
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

test('keeps two-car candidates valid for five and eight cars across seeds and supports the maximum size', async ({ page }) => {
  for (const count of [5, 8]) {
    for (const seed of ['wide-seed-alpha', 'wide-seed-omega']) {
      await importEvent(page, eventWithCars(count));
      await page.getByLabel('Schedule type').selectOption('custom');
      await page.getByLabel('Schedule seed').fill(seed);
      await page.getByLabel('Number of matches').fill('4');
      await page.getByRole('button', { name: 'Generate candidate' }).click();
      const quality = await page.locator('[data-quality-report]').evaluate((node) => JSON.parse(node.getAttribute('data-quality-report') ?? '{}'));
      expect(quality.status).not.toBe('invalid');
      expect(quality.appearanceImbalance).toBeLessThanOrEqual(1);
      expect(quality.maximumLaneSpread).toBeLessThanOrEqual(1);
      expect(Object.values(quality.twoCarHeatCounts).some((value) => Number(value) > 0)).toBe(true);
    }
  }

  await importEvent(page, eventWithCars(24));
  await page.getByLabel('Schedule type').selectOption('custom');
  await page.getByLabel('Schedule seed').fill('supported-max-proof');
  await page.getByLabel('Number of matches').fill('10');
  await page.getByRole('button', { name: 'Generate candidate' }).click();
  const maximum = await page.locator('[data-quality-report]').evaluate((node) => JSON.parse(node.getAttribute('data-quality-report') ?? '{}'));
  expect(maximum.status).not.toBe('invalid');
  expect(maximum.maximumLaneSpread).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-schedule-heat]')).toHaveCount(80);
});
