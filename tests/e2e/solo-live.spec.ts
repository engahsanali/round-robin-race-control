import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../single-file/index.html', import.meta.url));
const fileUrl = pathToFileURL(htmlPath).href;

async function openLiveDemo(page: Page) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Live Racing' }).click();
}

function liveEvent(lanes: [string, string, string | null], status = 'scheduled') {
  const timestamp = '2026-08-13T00:00:00.000Z';
  const count = new Set(lanes.filter(Boolean)).size;
  return {
    version: 1,
    event: { id: 'event-live', name: 'Live persistence test', date: '2026-08-13', venue: '', organizer: '', laneCount: 3, status: 'running', createdAt: timestamp, updatedAt: timestamp, resultSeal: 'draft' },
    settings: { scheduleMode: 'custom', seed: 'live', rankingMode: 'competition', allowSharedRanks: true, tieBreakOrder: ['totalWins'], finalistCount: 3, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: { standard: 100 } },
    participants: Array.from({ length: count }, (_, index) => ({ id: `person-${index + 1}`, name: `Driver ${index + 1}`, email: '', phone: '', notes: '' })),
    entries: Array.from({ length: count }, (_, index) => ({ id: `entry-${index + 1}`, participantId: `person-${index + 1}`, carNumber: index + 1, name: `Car ${index + 1}`, categoryId: 'standard', quantity: 1, active: true })),
    matches: [{ id: 'heat-live', phase: 'preliminary', matchNumber: 1, heatNumber: 1, lanes, status, winnerEntryId: status === 'completed' ? 'entry-2' : null, laneTimesMs: status === 'completed' ? [1250, 1190, lanes[2] ? 1310 : null] : [null, null, null], notes: 'Imported live note' }],
    finals: [], payments: [], auditLog: status === 'completed' ? [{ id: 'audit-correction', timestamp, action: 'result.corrected', summary: 'Winner corrected for finish judge review.', entityType: 'heat', entityId: 'heat-live', details: { reason: 'Finish judge review' } }] : [],
  };
}

async function importLiveEvent(page: Page, value: unknown) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByLabel('Import event JSON').setInputFiles({ name: 'live.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.getByRole('button', { name: 'Live Racing' }).click();
}

test('records a keyboard-selected winner with optional times, receipt, auto-advance, and undo', async ({ page }) => {
  await openLiveDemo(page);

  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 1' })).toBeVisible();
  await expect(page.locator('[data-lane-card]')).toHaveCount(3);
  await page.keyboard.press('2');
  await expect(page.getByRole('button', { name: /Lane 2.*Sample Car 02/i })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Pending result confirmation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confirm winner' })).toBeFocused();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /Lane 2.*Sample Car 02/i })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('Lane 1 time in milliseconds').fill('1250');
  await page.getByLabel('Lane 2 time in milliseconds').fill('1190');
  await page.getByLabel('Lane 3 time in milliseconds').fill('1310');
  await page.getByRole('button', { name: 'Confirm winner' }).click();

  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 2' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 2' })).toBeFocused();
  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.matches[0]).toMatchObject({ status: 'completed', winnerEntryId: 'car-02', laneTimesMs: [1250, 1190, 1310] });
  expect(after.auditLog.at(-1)).toMatchObject({ action: 'result.recorded', entityId: after.matches[0].id });
  await expect(page.getByRole('status', { name: 'Result receipt' })).toContainText('Sample Car 02');
  await expect(page.getByRole('status', { name: 'Result receipt' })).not.toContainText('@example.test');

  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(undone.matches[0]).toMatchObject({ status: 'scheduled', winnerEntryId: null, laneTimesMs: [null, null, null] });
  expect(undone.auditLog.at(-1)).toMatchObject({ action: 'result.undone', entityId: undone.matches[0].id });

  await page.keyboard.press('Control+z');
  await expect(page.locator('#view-content').getByText('Nothing to undo.', { exact: true })).toBeVisible();
});

test('blocks unassigned winners and requires a reason for winner changes', async ({ page }) => {
  await openLiveDemo(page);
  await page.getByRole('button', { name: 'Cancel heat' }).click();
  await page.getByLabel('Cancellation reason').fill('Lane obstruction');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await page.getByRole('button', { name: 'Mark for rerun' }).click();
  await expect(page.getByLabel('Rerun reason')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm rerun' }).click();
  await expect(page.getByLabel('Rerun reason')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Rerun reason').fill('False start reviewed');
  await page.getByRole('button', { name: 'Confirm rerun' }).click();
  await expect(page.getByText('Rerun pending', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Lane 1.*Sample Car 01/i }).click();
  await page.getByRole('button', { name: 'Review winner' }).click();
  await page.getByRole('button', { name: 'Confirm winner' }).click();
  await page.getByRole('button', { name: 'Previous heat' }).click();
  await page.getByRole('button', { name: /Lane 3.*Sample Car 03/i }).click();
  await page.getByRole('button', { name: 'Review winner change' }).click();
  await expect(page.getByLabel('Change reason')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm winner change' }).click();
  await expect(page.getByLabel('Change reason')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Change reason').fill('Finish judge correction');
  await page.getByRole('button', { name: 'Confirm winner change' }).click();

  const changed = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(changed.matches[0].winnerEntryId).toBe('car-03');
  expect(changed.auditLog.at(-1)).toMatchObject({ action: 'result.corrected', details: { reason: 'Finish judge correction', beforeWinnerEntryId: 'car-01', afterWinnerEntryId: 'car-03' } });
  const wins = changed.entries.map((entry: any) => changed.matches.filter((heat: any) => heat.status === 'completed' && heat.winnerEntryId === entry.id).length);
  expect(wins.reduce((total: number, count: number) => total + count, 0)).toBe(1);

  await page.evaluate(() => {
    const card = document.createElement('button');
    card.dataset.action = 'select-winner';
    card.dataset.entryId = 'car-not-in-heat';
    document.body.append(card);
    card.click();
    card.remove();
  });
  await expect(page.locator('#view-content').getByText('Winner must be assigned to this heat.', { exact: true })).toBeVisible();
});

test('supports arrow navigation, issue notes, cancellation, rerun, and compact official standings', async ({ page }) => {
  await openLiveDemo(page);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 2' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 1' })).toBeVisible();

  await page.getByLabel('Race issue or note').fill('Track inspected before rerun');
  await page.getByRole('button', { name: 'Save issue note' }).click();
  await page.getByRole('button', { name: 'Cancel heat' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('Cancellation reason is required.', { exact: true })).toBeVisible();
  await page.getByLabel('Cancellation reason').fill('False start');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark for rerun' }).click();
  await page.getByLabel('Rerun reason').fill('Restart authorized');
  await page.getByRole('button', { name: 'Confirm rerun' }).click();
  await expect(page.getByText('Rerun pending', { exact: true })).toBeVisible();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Confirm winner' }).click();

  const state = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(state.matches[0]).toMatchObject({ status: 'completed', winnerEntryId: 'car-01', notes: 'Track inspected before rerun' });
  expect(state.auditLog.map((entry: any) => entry.action)).toEqual(expect.arrayContaining(['heat.issue-noted', 'heat.cancelled', 'heat.rerun-marked', 'result.recorded']));
  expect(state.auditLog.find((entry: any) => entry.action === 'heat.rerun-marked')).toMatchObject({ details: { reason: 'Restart authorized' } });
  await expect(page.getByRole('table', { name: 'Compact standings' })).toContainText('Sample Car 01');
  await expect(page.getByRole('table', { name: 'Compact standings' })).toContainText('1');

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('u');
  const undone = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(undone.matches[0]).toMatchObject({ status: 'rerun', winnerEntryId: null });
  expect(undone.auditLog.at(-1)).toMatchObject({ action: 'result.undone' });
});

test('renders imported completed results, official winner, saved times, correction context, and reloads them', async ({ page }) => {
  await importLiveEvent(page, liveEvent(['entry-1', 'entry-2', 'entry-3'], 'completed'));
  await expect(page.getByRole('button', { name: /Lane 2.*Car 2.*official winner/i })).toHaveAttribute('data-official-winner', 'true');
  await expect(page.getByText('1,190 ms', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved official result' })).toContainText('Finish judge review');
  await expect(page.getByTestId('save-confidence')).toContainText('Saved locally');

  await page.reload();
  await page.getByRole('button', { name: 'Live Racing' }).click();
  await expect(page.getByRole('button', { name: /Lane 2.*Car 2.*official winner/i })).toHaveAttribute('data-official-winner', 'true');
  const persisted = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(persisted.matches[0]).toMatchObject({ status: 'completed', winnerEntryId: 'entry-2', laneTimesMs: [1250, 1190, 1310] });
});

test('offers timing only for assigned two-car lanes and preserves the empty lane as null', async ({ page }) => {
  await importLiveEvent(page, liveEvent(['entry-1', 'entry-2', null]));
  await page.getByRole('button', { name: /Lane 2.*Car 2/i }).click();
  await page.getByRole('button', { name: 'Review winner' }).click();
  await expect(page.getByLabel(/time in milliseconds/)).toHaveCount(2);
  await expect(page.getByLabel('Lane 3 time in milliseconds')).toHaveCount(0);
  await page.getByLabel('Lane 1 time in milliseconds').fill('1400');
  await page.getByLabel('Lane 2 time in milliseconds').fill('1300');
  await page.getByRole('button', { name: 'Confirm winner' }).click();
  const state = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(state.matches[0].laneTimesMs).toEqual([1400, 1300, null]);
});
