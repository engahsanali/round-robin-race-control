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

function collidingPresetEvent(name: string, firstStatus: 'scheduled' | 'completed' = 'scheduled') {
  const timestamp = '2026-08-13T00:00:00.000Z';
  return {
    version: 1,
    event: { id: `event-${name.toLowerCase().replaceAll(' ', '-')}`, name, date: '2026-08-14', venue: 'Imported venue', organizer: 'Imported crew', laneCount: 3, status: 'running', createdAt: timestamp, updatedAt: timestamp, resultSeal: 'draft' },
    settings: { scheduleMode: 'template9', seed: `seed-${name}`, rankingMode: 'competition', allowSharedRanks: true, tieBreakOrder: ['totalWins'], finalistCount: 3, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: { standard: 100 } },
    participants: Array.from({ length: 9 }, (_, index) => ({ id: `participant-${String(index + 1).padStart(2, '0')}`, name: `${name} Driver ${index + 1}`, email: '', phone: '', notes: '' })),
    entries: Array.from({ length: 9 }, (_, index) => ({ id: `car-${String(index + 1).padStart(2, '0')}`, participantId: `participant-${String(index + 1).padStart(2, '0')}`, carNumber: 100 + index, name: `${name} Car ${index + 1}`, categoryId: 'standard', quantity: 1, active: true })),
    matches: [
      { id: 'preset-template9-match-1-heat-1', phase: 'preliminary', matchNumber: 1, heatNumber: 1, lanes: ['car-01', 'car-02', 'car-03'], status: firstStatus, winnerEntryId: firstStatus === 'completed' ? 'car-03' : null, laneTimesMs: firstStatus === 'completed' ? [1500, 1400, 1300] : [null, null, null], notes: `${name} first heat` },
      { id: 'preset-template9-match-1-heat-2', phase: 'preliminary', matchNumber: 1, heatNumber: 2, lanes: ['car-04', 'car-05', 'car-06'], status: 'scheduled', winnerEntryId: null, laneTimesMs: [null, null, null], notes: `${name} second heat` },
    ],
    finals: [], payments: [], auditLog: [],
  };
}

async function uploadEvent(page: Page, value: unknown, name = 'context.json') {
  await page.getByLabel('Import event JSON').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

async function recordVisibleWinner(page: Page, entryId: string) {
  await page.locator(`[data-lane-card][data-entry-id="${entryId}"]`).click();
  await page.getByRole('button', { name: 'Review winner' }).click();
  await page.getByRole('button', { name: 'Confirm winner' }).click();
}

test('runs qualification playoff and championship finals through phase-aware live controls before sealing', async ({ page }) => {
  const timestamp = '2026-08-13T00:00:00.000Z';
  const event = {
    version: 1,
    event: { id: 'phase-lifecycle', name: 'Phase Lifecycle', date: '2026-08-14', venue: '', organizer: '', laneCount: 3, status: 'running', createdAt: timestamp, updatedAt: timestamp, resultSeal: 'provisional' },
    settings: { scheduleMode: 'custom', seed: 'phase-life', rankingMode: 'competition', allowSharedRanks: true, tieBreakOrder: ['totalWins'], finalistCount: 2, autoSave: true, confirmWinnerChanges: true, enableTiming: false, prices: { standard: 100 } },
    participants: Array.from({ length: 5 }, (_, index) => ({ id: `person-${index + 1}`, name: `Driver ${index + 1}`, email: '', phone: '', notes: '' })),
    entries: Array.from({ length: 5 }, (_, index) => ({ id: `car-${index + 1}`, participantId: `person-${index + 1}`, carNumber: index + 1, name: `Car ${index + 1}`, categoryId: 'standard', quantity: 1, active: true })),
    matches: [
      { id: 'leader-1', phase: 'preliminary', matchNumber: 1, heatNumber: 1, lanes: ['car-1', 'car-2', 'car-3'], status: 'completed', winnerEntryId: 'car-1', laneTimesMs: [900, 1000, 1010], notes: '' },
      { id: 'leader-2', phase: 'preliminary', matchNumber: 2, heatNumber: 1, lanes: ['car-1', 'car-4', 'car-5'], status: 'completed', winnerEntryId: 'car-1', laneTimesMs: [890, 1020, 1030], notes: '' },
      ...Array.from({ length: 4 }, (_, index) => ({ id: `tie-${index + 1}`, phase: 'preliminary', matchNumber: index + 3, heatNumber: 1, lanes: [`car-${index + 2}`, 'car-1', `car-${((index + 1) % 4) + 2}`], status: 'completed', winnerEntryId: `car-${index + 2}`, laneTimesMs: [950, 1100, 1150], notes: '' })),
    ], finals: [], payments: [], auditLog: [],
  };
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await uploadEvent(page, event);
  await page.getByRole('button', { name: 'Finals' }).click();
  await page.getByRole('button', { name: 'Generate qualification playoff' }).click();
  await page.getByRole('button', { name: 'Live Racing' }).click();
  await page.getByLabel('Race phase').selectOption('qualification');
  await expect(page.getByRole('paragraph').filter({ hasText: 'Qualification Playoff' })).toBeVisible();
  for (let index = 0; index < 6; index += 1) {
    const lanes = await page.locator('[data-lane-card]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-entry-id')));
    await recordVisibleWinner(page, lanes.includes('car-2') ? 'car-2' : lanes[0]!);
  }
  const playoffState = await page.evaluate(() => (window as any).RR3.getState());
  expect(playoffState.finals.filter((heat: any) => heat.status === 'completed')).toHaveLength(6);

  await page.getByRole('button', { name: 'Finals' }).click();
  await expect(page.getByRole('list', { name: 'Selected finalists' })).toContainText('Car 2');
  await page.getByRole('button', { name: 'Generate finals schedule' }).click();
  await page.getByLabel('Finals replacement reason').fill('Qualification completed; create championship finals');
  await page.getByRole('button', { name: 'Confirm finals replacement' }).click();
  await page.getByRole('button', { name: 'Live Racing' }).click();
  await page.getByLabel('Race phase').selectOption('championship');
  const championshipCount = await page.locator('[data-live-phase-count]').getAttribute('data-live-phase-count');
  for (let index = 0; index < Number(championshipCount); index += 1) await recordVisibleWinner(page, 'car-2');
  await page.getByRole('button', { name: 'Finals' }).click();
  await expect(page.getByRole('button', { name: 'Seal official results' })).toBeEnabled();
  await page.getByRole('button', { name: 'Seal official results' }).click();
  await expect(page.locator('[data-official-champion]')).toContainText('Car 2');
});

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

test('successful import clears every event-scoped live, schedule, undo, receipt, and staged-dialog transient', async ({ page }) => {
  await openLiveDemo(page);
  await page.getByRole('button', { name: 'Race Setup' }).click();
  await page.getByLabel('Schedule type').selectOption('template9');
  await page.getByRole('button', { name: 'Activate schedule' }).click();
  await page.getByLabel('Schedule type').selectOption('custom');
  await page.getByLabel('Schedule seed').fill('STALE-DRAFT-SEED');
  await page.getByLabel('Number of matches').fill('4');
  await page.getByRole('button', { name: 'Generate candidate' }).click();
  await expect(page.getByText(/STALE-DRAFT-SEED/)).toBeVisible();

  await page.getByRole('button', { name: 'Live Racing' }).click();
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Confirm winner' }).click();
  await expect(page.getByRole('status', { name: 'Result receipt' })).toBeVisible();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const invalid = document.createElement('button');
    invalid.dataset.action = 'select-winner';
    invalid.dataset.entryId = 'not-in-this-event';
    document.body.append(invalid);
    invalid.click();
    invalid.remove();
  });
  await expect(page.getByRole('region', { name: 'Pending result confirmation' })).toBeVisible();
  await expect(page.locator('#view-content').getByText('Winner must be assigned to this heat.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel heat' }).click();
  await page.getByLabel('Cancellation reason').fill('STALE PENDING HEAT ACTION');

  const imported = collidingPresetEvent('Imported Alpha', 'completed');
  await uploadEvent(page, imported, 'imported-alpha.json');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Imported Alpha', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Match 1 · Heat 1' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Result receipt' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pending result confirmation' })).toHaveCount(0);
  await expect(page.locator('[data-lane-card][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('#view-content').getByText('Winner must be assigned to this heat.', { exact: true })).toHaveCount(0);

  const afterImport = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(afterImport.matches).toEqual(imported.matches);
  await page.keyboard.press('u');
  await page.keyboard.press('Control+z');
  expect((await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState())).matches).toEqual(imported.matches);

  await page.getByRole('button', { name: 'Race Setup' }).click();
  await page.getByLabel('Schedule type').selectOption('custom');
  await expect(page.getByLabel('Schedule seed')).toHaveValue(imported.settings.seed);
  await expect(page.getByText(/STALE-DRAFT-SEED/)).toHaveCount(0);
  await page.getByLabel('Schedule type').selectOption('template9');
  await page.getByRole('button', { name: 'Activate schedule' }).click();
  await expect(page.getByRole('dialog')).toContainText(/completed, cancelled, or rerun heat/);

  const importedAgain = collidingPresetEvent('Imported Beta');
  await uploadEvent(page, importedAgain, 'imported-beta.json');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.evaluate(() => {
    const staleConfirm = document.createElement('button');
    staleConfirm.dataset.action = 'confirm-schedule-replacement';
    document.body.append(staleConfirm);
    staleConfirm.click();
    staleConfirm.remove();
  });
  expect((await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState())).matches).toEqual(importedAgain.matches);
});

test('failed import preserves the canonical event and usable schedule, receipt, undo, and staged live state', async ({ page }) => {
  await importLiveEvent(page, collidingPresetEvent('Preserved Context'));
  await page.getByRole('button', { name: 'Race Setup' }).click();
  await page.getByLabel('Schedule type').selectOption('custom');
  await page.getByLabel('Schedule seed').fill('PRESERVED-DRAFT-SEED');
  await page.getByLabel('Number of matches').fill('3');
  await page.getByRole('button', { name: 'Generate candidate' }).click();
  await page.getByRole('button', { name: 'Live Racing' }).click();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Confirm winner' }).click();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Cancel heat' }).click();
  await page.getByLabel('Cancellation reason').fill('PRESERVE THIS STAGED REASON');
  const before = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  const invalid = structuredClone(before);
  invalid.matches[0].winnerEntryId = 'unknown-car';

  await uploadEvent(page, invalid, 'invalid-context.json');
  expect(await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState())).toEqual(before);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Cancellation reason')).toHaveValue('PRESERVE THIS STAGED REASON');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pending result confirmation' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Result receipt' })).toBeVisible();
  await page.keyboard.press('u');
  const undone = await page.evaluate(() => (window as unknown as { RR3: { getState(): any } }).RR3.getState());
  expect(undone.matches[0]).toMatchObject({ status: 'scheduled', winnerEntryId: null });
  await page.getByRole('button', { name: 'Race Setup' }).click();
  await expect(page.getByLabel('Schedule seed')).toHaveValue('PRESERVED-DRAFT-SEED');
});
