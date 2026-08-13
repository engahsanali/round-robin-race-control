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

test('records a keyboard-selected winner with optional times, receipt, auto-advance, and undo', async ({ page }) => {
  await openLiveDemo(page);

  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 1' })).toBeVisible();
  await expect(page.locator('[data-lane-card]')).toHaveCount(3);
  await page.keyboard.press('2');
  await expect(page.getByRole('button', { name: /Lane 2.*Sample Car 02/i })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Pending result confirmation' })).toBeVisible();
  await page.getByLabel('Lane 1 time in milliseconds').fill('1250');
  await page.getByLabel('Lane 2 time in milliseconds').fill('1190');
  await page.getByLabel('Lane 3 time in milliseconds').fill('1310');
  await page.getByRole('button', { name: 'Confirm winner' }).click();

  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 2' })).toBeVisible();
  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.matches[0]).toMatchObject({ status: 'completed', winnerEntryId: 'car-02', laneTimesMs: [1250, 1190, 1310] });
  expect(after.auditLog.at(-1)).toMatchObject({ action: 'result.recorded', entityId: after.matches[0].id });
  await expect(page.getByRole('status', { name: 'Result receipt' })).toContainText('Sample Car 02');
  await expect(page.getByRole('status', { name: 'Result receipt' })).not.toContainText('@example.test');

  await page.keyboard.press('u');
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
  await expect(page.getByText('Rerun pending', { exact: true })).toBeVisible();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Confirm winner' }).click();

  const state = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(state.matches[0]).toMatchObject({ status: 'completed', winnerEntryId: 'car-01', notes: 'Track inspected before rerun' });
  expect(state.auditLog.map((entry: any) => entry.action)).toEqual(expect.arrayContaining(['heat.issue-noted', 'heat.cancelled', 'heat.rerun', 'result.recorded']));
  await expect(page.getByRole('table', { name: 'Compact standings' })).toContainText('Sample Car 01');
  await expect(page.getByRole('table', { name: 'Compact standings' })).toContainText('1');
});
