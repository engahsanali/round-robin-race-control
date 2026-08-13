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

test('registers a participant and car inside the Participants wizard step before arming', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Create Real Event' }).click();
  await page.getByLabel('Event name').fill('Wizard Derby');
  await page.getByLabel('Event date').fill('2026-09-02');
  await page.getByRole('button', { name: 'Next step' }).click();
  await page.getByLabel('Category ID').fill('junior');
  await page.getByLabel('Category name').fill('Junior');
  await page.getByLabel('Price in cents').fill('900');
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByRole('button', { name: 'Next step' }).click();

  await page.getByLabel('Wizard participant name').fill('Kai Racer');
  await page.getByLabel('Wizard participant email').fill('kai@example.test');
  await page.getByRole('button', { name: 'Add wizard participant' }).click();
  await page.getByLabel('Wizard participant for car').selectOption({ label: 'Kai Racer' });
  await page.getByLabel('Wizard car number').fill('22');
  await page.getByLabel('Wizard car name').fill('Lightning');
  await page.getByLabel('Wizard car category').selectOption('junior');
  await page.getByLabel('Wizard entry quantity').fill('1');
  await page.getByRole('button', { name: 'Add wizard car' }).click();
  await expect(page.getByText('Kai Racer — #22 Lightning', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Next step' }).click();
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('1 participant · 1 car', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Arm registration' }).click();
  const state = await page.evaluate(() => (window as unknown as { RR3: { getState(): { participants: unknown[]; entries: unknown[] } } }).RR3.getState());
  expect(state.participants).toHaveLength(1);
  expect(state.entries).toHaveLength(1);
});

test('associates precise submission errors with invalid fields and announces them', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Create Real Event' }).click();
  await page.getByRole('button', { name: 'Next step' }).click();

  const name = page.getByLabel('Event name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await name.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toHaveText('Event name is required.');
  await expect(page.locator(`#${describedBy}`)).toHaveAttribute('role', 'alert');
  await expect(page.locator(`#${describedBy}`)).toHaveAttribute('aria-live', 'assertive');
});

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

test('keyboard-edits participant contact fields without replacing its stable ID', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  const trigger = page.getByRole('button', { name: 'Edit participant Sample 01 - Ada' });
  await trigger.focus();
  await trigger.press('Enter');
  await page.getByLabel('Edit participant name').fill('');
  await page.getByRole('button', { name: 'Save participant' }).click();
  const invalid = page.getByLabel('Edit participant name');
  await expect(invalid).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Edit participant email')).not.toHaveAttribute('aria-invalid');
  const errorId = await invalid.getAttribute('aria-describedby');
  await expect(page.locator(`#${errorId}`)).toHaveAttribute('role', 'alert');
  await page.getByLabel('Edit participant name').fill('Ada Lovelace');
  await page.getByLabel('Edit participant email').fill('ada.l@example.test');
  await page.getByLabel('Edit participant phone').fill('+61 411 111 111');
  await page.getByLabel('Edit participant notes').fill('Updated at registration desk');
  await page.getByRole('button', { name: 'Save participant' }).click();
  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.participants[0]).toMatchObject({ id: before.participants[0].id, name: 'Ada Lovelace', email: 'ada.l@example.test', phone: '+61 411 111 111', notes: 'Updated at registration desk' });
  expect(after.auditLog.length).toBeGreaterThan(before.auditLog.length);
  await expect(page.getByText('Ada Lovelace', { exact: true }).first()).toBeVisible();
});

test('validates and confirms scheduled car corrections while preserving ID and recalculating fees', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  await page.getByRole('button', { name: 'Edit Sample Car 01' }).press('Enter');
  await expect(page.getByRole('dialog')).toContainText('appears in 4 heats');
  await page.getByLabel('Edit car number').fill('2');
  await page.getByRole('button', { name: 'Save car' }).click();
  const duplicate = page.getByLabel('Edit car number');
  await expect(duplicate).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Edit car name')).not.toHaveAttribute('aria-invalid');
  await page.getByLabel('Edit car number').fill('21');
  await page.getByLabel('Edit car name').fill('Ada Arrow GT');
  await page.getByLabel('Edit car category').selectOption('standard');
  await page.getByLabel('Edit entry quantity').fill('2');
  await page.getByRole('button', { name: 'Save car' }).click();
  await expect(page.getByRole('dialog')).toContainText(/scheduled-impact confirmation/i);
  await page.getByRole('button', { name: 'Confirm car changes' }).click();
  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.entries[0]).toMatchObject({ id: before.entries[0].id, carNumber: 21, name: 'Ada Arrow GT', categoryId: 'standard', quantity: 2 });
  await expect(page.locator(`[data-account-row="${before.participants[0].id}"]`)).toContainText('$12.00');
  expect(after.auditLog.length).toBeGreaterThan(before.auditLog.length);
});

test('safely corrects a payment record in place and updates accounting and audit', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  await page.getByRole('button', { name: 'Edit payment Paid in full example' }).press('Enter');
  await page.getByLabel('Edit amount in cents').fill('-1');
  await page.getByRole('button', { name: 'Save payment correction' }).click();
  await expect(page.getByLabel('Edit amount in cents')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Edit transaction type')).not.toHaveAttribute('aria-invalid');
  await page.getByLabel('Edit amount in cents').fill('600');
  await page.getByLabel('Edit transaction type').selectOption('payment');
  await page.getByLabel('Edit payment reference').fill('Corrected receipt');
  await page.getByLabel('Edit paid at').fill('2026-08-13T03:00:00.000Z');
  await page.getByLabel('Correction reason').fill('Receipt amount corrected');
  await page.getByRole('button', { name: 'Save payment correction' }).click();
  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.payments[0]).toMatchObject({ id: before.payments[0].id, amountCents: 600, kind: 'payment', note: 'Corrected receipt', paidAt: '2026-08-13T03:00:00.000Z' });
  await expect(page.locator(`[data-account-row="${before.participants[0].id}"]`)).toContainText('$6.00');
  expect(after.auditLog.at(-1)).toMatchObject({ action: 'payment.corrected', entityId: before.payments[0].id });
});

test('associates setup event validation only with affected fields', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Race Setup' }).click();
  await page.getByLabel('Event name').fill('');
  await page.getByRole('button', { name: 'Save event details' }).click();
  const invalid = page.getByLabel('Event name');
  await expect(invalid).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Event date')).not.toHaveAttribute('aria-invalid');
  const errorId = await invalid.getAttribute('aria-describedby');
  await expect(page.locator(`#${errorId}`)).toHaveText('Event name is required.');
  await expect(page.locator(`#${errorId}`)).toHaveAttribute('aria-live', 'assertive');
});

test('transfers a car charge to another participant without replacing the car ID', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  await page.getByRole('button', { name: 'Edit Sample Car 01' }).click();
  await page.getByLabel('Edit car participant').evaluate((select) => select.append(new Option('Missing participant', 'participant-missing')));
  await page.getByLabel('Edit car participant').selectOption('participant-missing');
  await page.getByRole('button', { name: 'Save car' }).click();
  await expect(page.getByLabel('Edit car participant')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Edit car number')).not.toHaveAttribute('aria-invalid');
  await page.getByLabel('Edit car participant').selectOption(before.participants[1].id);
  await page.getByRole('button', { name: 'Save car' }).click();
  await page.getByRole('button', { name: 'Confirm car changes' }).click();

  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.entries[0]).toMatchObject({ id: before.entries[0].id, participantId: before.participants[1].id });
  expect(after.auditLog.at(-1)).toMatchObject({ entityId: before.entries[0].id, details: { beforeParticipantId: before.participants[0].id, afterParticipantId: before.participants[1].id } });
  await expect(page.locator(`[data-account-row="${before.participants[0].id}"]`)).toContainText('$12.00 credit');
  await expect(page.locator(`[data-account-row="${before.participants[1].id}"]`)).toContainText('$24.00');
});

test('transfers a payment to another participant without replacing the payment ID', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  await page.getByRole('button', { name: 'Edit payment Paid in full example' }).click();
  await page.getByLabel('Edit payment participant').evaluate((select) => select.append(new Option('Missing participant', 'participant-missing')));
  await page.getByLabel('Edit payment participant').selectOption('participant-missing');
  await page.getByLabel('Correction reason').fill('Correct ownership');
  await page.getByRole('button', { name: 'Save payment correction' }).click();
  await expect(page.getByLabel('Edit payment participant')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Edit amount in cents')).not.toHaveAttribute('aria-invalid');
  await page.getByLabel('Edit payment participant').selectOption(before.participants[1].id);
  await page.getByRole('button', { name: 'Save payment correction' }).click();

  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.payments[0]).toMatchObject({ id: before.payments[0].id, participantId: before.participants[1].id, amountCents: 1200 });
  expect(after.auditLog.at(-1)).toMatchObject({ action: 'payment.corrected', entityId: before.payments[0].id, details: { before: { participantId: before.participants[0].id }, after: { participantId: before.participants[1].id } } });
  await expect(page.locator(`[data-account-row="${before.participants[0].id}"]`)).toContainText('$12.00');
  await expect(page.locator(`[data-account-row="${before.participants[1].id}"]`)).toContainText('Paid');
});

test('marks only invalid add-form controls and keeps form alerts for cross-field failures', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();

  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByLabel('Participant name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Email')).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('#participant-form-error')).toBeEmpty();

  await page.getByLabel('Car number').fill('1');
  await page.getByLabel('Car name').fill('Duplicate');
  await page.getByRole('button', { name: 'Add car' }).click();
  await expect(page.getByLabel('Car number')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Car name')).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('#car-form-error')).toBeEmpty();

  await page.getByLabel('Amount in cents').fill('100');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByLabel('Payment reference')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Amount in cents')).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('#payment-form-error')).toBeEmpty();
});

test('discards a pending scheduled car edit when Escape closes confirmation', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
  await page.getByRole('button', { name: 'Registration' }).click();
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  await page.getByRole('button', { name: 'Edit Sample Car 01' }).click();
  await page.getByLabel('Edit car number').fill('21');
  await page.getByRole('button', { name: 'Save car' }).click();
  await page.getByRole('dialog').press('Escape');
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.dataset.action = 'confirm-car-edit';
    document.body.append(button);
    button.click();
    button.remove();
  });
  const after = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(after.entries[0]).toMatchObject({ id: before.entries[0].id, carNumber: before.entries[0].carNumber });
});
