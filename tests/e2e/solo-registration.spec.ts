import { expect, test } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fileUrl = pathToFileURL(fileURLToPath(new URL('../../single-file/index.html', import.meta.url))).href;

async function createEvent(page: Parameters<typeof test>[0]['page']) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Create Real Event' }).click();
  await expect(page.getByRole('heading', { name: 'Create your event' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Setup progress' }).getByRole('listitem')).toHaveText([
    /Event/, /Categories & Prices/, /Participants/, /Race Format/, /Review & Arm/,
  ]);

  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Event name is required.', { exact: true })).toBeVisible();
  await page.getByLabel('Event name').fill('Community Derby');
  await page.getByLabel('Event date').fill('2026-09-01');
  await page.getByLabel('Venue').fill('César Hall');
  await page.getByLabel('Organizer').fill('Ahsan Ali');
  await page.getByRole('button', { name: 'Next step' }).click();

  await page.getByLabel('Category ID').fill('standard');
  await page.getByLabel('Category name').fill('Standard');
  await page.getByLabel('Price in cents').fill('1250');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText('Standard — $12.50', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next step' }).click();
  await page.getByRole('button', { name: 'Next step' }).click();
  await page.getByLabel('Schedule mode').selectOption('custom');
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText(/Community Derby/)).toBeVisible();
  await expect(page.getByText(/1 categor/)).toBeVisible();
  await page.getByRole('button', { name: 'Arm registration' }).click();
  await expect(page.getByText('Community Derby', { exact: true }).first()).toBeVisible();
}

test('guides event setup and manages stable participant and car records', async ({ page }) => {
  await createEvent(page);
  await page.getByRole('button', { name: 'Registration' }).click();

  await page.getByLabel('Participant name').fill('Zoë Driver');
  await page.getByLabel('Email').fill('zoe@example.test');
  await page.getByLabel('Phone').fill('+61 400 000 000');
  await page.getByLabel('Participant notes').fill('Needs accessible staging');
  await page.getByRole('button', { name: 'Add participant' }).click();

  await page.getByLabel('Participant for car').selectOption({ label: 'Zoë Driver' });
  await page.getByLabel('Car number').fill('12');
  await page.getByLabel('Car name').fill('Comet');
  await page.getByLabel('Category').selectOption('standard');
  await page.getByLabel('Entry quantity').fill('2');
  await page.getByRole('button', { name: 'Add car' }).click();
  await page.getByLabel('Car number').fill('7');
  await page.getByLabel('Car name').fill('Nova');
  await page.getByLabel('Entry quantity').fill('1');
  await page.getByRole('button', { name: 'Add car' }).click();

  const initial = await page.evaluate(() => (window as unknown as { RR3: { getState(): { entries: Array<{ id: string; carNumber: number }> } } }).RR3.getState().entries);
  expect(initial).toHaveLength(2);
  expect(new Set(initial.map(({ id }) => id)).size).toBe(2);

  await page.getByLabel('Car number').fill('7');
  await page.getByLabel('Car name').fill('Duplicate');
  await page.getByRole('button', { name: 'Add car' }).click();
  await expect(page.getByText('Active car number 7 is already in use.', { exact: true })).toBeVisible();
  await page.getByLabel('Car number').fill('13');
  await page.getByLabel('Entry quantity').fill('0');
  await page.getByRole('button', { name: 'Add car' }).click();
  await expect(page.getByText('Quantity must be a positive whole number.', { exact: true })).toBeVisible();

  await page.getByLabel('Sort cars').selectOption('number-desc');
  await page.getByLabel('Account filter').selectOption('outstanding');
  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): { entries: Array<{ id: string; carNumber: number }> } } }).RR3.getState().entries);
  expect(after).toEqual(initial);
  await expect(page.locator('[data-car-row]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Edit Comet' }).click();
  await page.getByLabel('Edit car name').fill('Comet GT');
  await page.getByRole('button', { name: 'Save car' }).click();
  await expect(page.getByText('Comet GT', { exact: true })).toBeVisible();
});

test('derives unpaid, partial, paid, credit, refund, and price-change accounts from cents', async ({ page }) => {
  await createEvent(page);
  await page.getByRole('button', { name: 'Registration' }).click();
  await page.getByLabel('Participant name').fill('Ada Racer');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await page.getByLabel('Participant for car').selectOption({ label: 'Ada Racer' });
  await page.getByLabel('Car number').fill('1');
  await page.getByLabel('Car name').fill('Bolt');
  await page.getByLabel('Category').selectOption('standard');
  await page.getByLabel('Entry quantity').fill('2');
  await page.getByRole('button', { name: 'Add car' }).click();

  const account = page.locator('[data-account-row]');
  await expect(account).toContainText('$25.00');
  await expect(account).toContainText('Unpaid');

  await page.getByLabel('Payment participant').selectOption({ label: 'Ada Racer' });
  await page.getByLabel('Amount in cents').fill('1000');
  await page.getByLabel('Payment reference').fill('Receipt 01');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(account).toContainText('Partial');
  await expect(account).toContainText('$15.00');

  await page.getByLabel('Amount in cents').fill('2000');
  await page.getByLabel('Payment reference').fill('Receipt 02');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(account).toContainText('Credit');
  await expect(account).toContainText('$5.00 credit');

  await page.getByLabel('Transaction type').selectOption('refund');
  await page.getByLabel('Amount in cents').fill('500');
  await page.getByLabel('Payment reference').fill('Refund 01');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(account).toContainText('Paid');

  await page.getByRole('button', { name: 'Race Setup' }).click();
  await page.getByRole('button', { name: 'Edit categories and prices' }).click();
  await page.getByLabel('Price for Standard in cents').fill('1500');
  await page.getByRole('button', { name: 'Save prices' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();
  await expect(account).toContainText('Partial');
  await expect(account).toContainText('$5.00');

  await page.getByLabel('Amount in cents').fill('-1');
  await page.getByLabel('Payment reference').fill('Bad');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Amount must be a non-negative whole number of cents.', { exact: true })).toBeVisible();
  await page.getByLabel('Amount in cents').fill('100');
  await page.getByLabel('Payment reference').fill('');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment reference is required.', { exact: true })).toBeVisible();
});

test('warns before withdrawing a scheduled demo car and can restore it', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();

  await page.getByRole('button', { name: 'Withdraw Sample Car 01' }).click();
  await expect(page.getByRole('dialog')).toContainText('This car appears in 4 scheduled or completed heats.');
  await page.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await expect(page.getByText('Withdrawn', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Restore Sample Car 01' }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
});
