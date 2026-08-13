import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fileUrl = pathToFileURL(fileURLToPath(new URL('../../single-file/index.html', import.meta.url))).href;
const views = ['dashboard', 'registration', 'setup', 'live', 'standings', 'finals', 'reports', 'settings', 'diagnostics'];
const printRoutes = ['registration', 'payments', 'schedule-cards', 'standings', 'podium', 'finals', 'audit'];

function finalsEvent() {
  const timestamp = '2026-08-14T00:00:00.000Z';
  const participants = Array.from({ length: 4 }, (_, index) => ({ id: `person-${index + 1}`, name: `Driver ${index + 1}`, email: '', phone: '', notes: '' }));
  const entries = participants.map((participant, index) => ({ id: `car-${index + 1}`, participantId: participant.id, carNumber: index + 1, name: `Finalist ${index + 1}`, categoryId: 'open', quantity: 1, active: true }));
  return {
    version: 1,
    event: { id: 'event-dialogs', name: 'Dialog Finals', date: '2026-08-14', venue: 'RR Hall', organizer: 'Race Crew', laneCount: 3, status: 'running', createdAt: timestamp, updatedAt: timestamp, resultSeal: 'provisional' },
    settings: { scheduleMode: 'custom', seed: 'dialog-proof', rankingMode: 'competition', allowSharedRanks: true, tieBreakOrder: ['totalWins'], finalistCount: 2, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: { open: 1000 } },
    participants, entries,
    matches: [
      { id: 'pre-1', phase: 'preliminary', matchNumber: 1, heatNumber: 1, lanes: ['car-1', 'car-2', 'car-3'], status: 'completed', winnerEntryId: 'car-1', laneTimesMs: [900, 1000, 1050], notes: '' },
      { id: 'pre-2', phase: 'preliminary', matchNumber: 2, heatNumber: 1, lanes: ['car-1', 'car-2', 'car-4'], status: 'completed', winnerEntryId: 'car-1', laneTimesMs: [890, 1010, 1080], notes: '' },
      { id: 'pre-3', phase: 'preliminary', matchNumber: 3, heatNumber: 1, lanes: ['car-2', 'car-3', 'car-4'], status: 'completed', winnerEntryId: 'car-2', laneTimesMs: [980, 1020, 1070], notes: '' },
      { id: 'pre-4', phase: 'preliminary', matchNumber: 4, heatNumber: 1, lanes: ['car-2', 'car-3', 'car-4'], status: 'completed', winnerEntryId: 'car-3', laneTimesMs: [990, 970, 1060], notes: '' },
    ],
    finals: [], payments: [], auditLog: [],
  };
}

async function importEvent(page: Page, value: unknown) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByLabel('Import event JSON').setInputFiles({ name: 'event.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

async function escapeDialog(page: Page, trigger: ReturnType<Page['getByRole']>) {
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'dialog-title');
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function loadDemo(page: Page) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  const trigger = page.getByRole('button', { name: 'Load Demo Event' });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await page.getByRole('button', { name: 'Load separate demo' }).press('Enter');
}

test('keeps every view semantic, keyboard reachable, and free of invalid focus order', async ({ page }) => {
  await loadDemo(page);
  for (const view of views) {
    const navigation = page.locator(`[data-view="${view}"]`);
    await navigation.focus();
    await navigation.press('Enter');
    await expect(page.locator('main')).toHaveAttribute('data-active-view', view);
    await expect(page.locator('main h2').first()).toBeVisible();
    await expect(navigation).toHaveAttribute('aria-current', 'page');
  }
  expect(await page.locator('[tabindex]').evaluateAll((nodes) => nodes.every((node) => Number(node.getAttribute('tabindex')) <= 0))).toBe(true);
  expect(await page.locator('button:not([type]), input:not([type]), [role="button"]').count()).toBe(0);
  expect(await page.locator('input:not([aria-label]):not([id]), select:not([aria-label]):not([id]), textarea:not([aria-label]):not([id])').count()).toBe(0);
});

test('supports keyboard-only live shortcuts without trapping focus', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Live Racing' }).focus();
  await page.getByRole('button', { name: 'Live Racing' }).press('Enter');
  await page.keyboard.press('1');
  await expect(page.locator('[data-lane-card]').nth(0)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Pending result confirmation' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm winner' }).press('Enter');
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('u');
  await expect(page.getByRole('status', { name: 'Result receipt' })).toContainText('was undone');
});

test('completes the official create-and-arm workflow without pointer input', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Create Real Event' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Event name').pressSequentially('Keyboard Cup');
  await page.getByLabel('Event date').fill('2026-08-14');
  await page.getByRole('button', { name: 'Next step' }).press('Enter');
  await page.getByLabel('Category ID').pressSequentially('open');
  await page.getByLabel('Category name').pressSequentially('Open');
  await page.getByLabel('Price in cents').pressSequentially('1000');
  await page.getByRole('button', { name: 'Add category' }).press('Enter');
  await page.getByRole('button', { name: 'Next step' }).press('Enter');
  await page.getByLabel('Wizard participant name').pressSequentially('Keyboard Driver');
  await page.getByRole('button', { name: 'Add wizard participant' }).press('Enter');
  await page.getByLabel('Wizard participant for car').focus();
  await page.keyboard.press('ArrowDown');
  await page.getByLabel('Wizard car number').pressSequentially('7');
  await page.getByLabel('Wizard car name').pressSequentially('Keyboard Car');
  await page.getByLabel('Wizard car category').focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Add wizard car' }).press('Enter');
  await page.getByRole('button', { name: 'Next step' }).press('Enter');
  await page.getByRole('button', { name: 'Next step' }).press('Enter');
  await page.getByRole('button', { name: 'Arm registration' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Keyboard Cup' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).RR3.getState())).toMatchObject({ event: { name: 'Keyboard Cup' }, participants: [{ name: 'Keyboard Driver' }], entries: [{ name: 'Keyboard Car' }] });
});

test('returns focus after Escape from registration, live, recovery, and finals dialog paths', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Registration' }).click();
  await escapeDialog(page, page.getByRole('button', { name: /Edit participant/ }).first());
  const editCar = page.getByRole('button', { name: /^Edit Sample Car/ }).first();
  await escapeDialog(page, editCar);
  await editCar.focus();
  await editCar.press('Enter');
  await page.getByRole('button', { name: 'Save car' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Confirm scheduled car correction' })).toBeVisible();
  await page.getByRole('dialog').press('Escape');
  await expect(editCar).toBeFocused();
  await escapeDialog(page, page.getByRole('button', { name: /Edit payment/ }).first());
  await escapeDialog(page, page.getByRole('button', { name: /^Withdraw Sample Car/ }).first());

  await page.getByRole('button', { name: 'Live Racing' }).click();
  await escapeDialog(page, page.getByRole('button', { name: 'Cancel heat' }));
  const cancelHeat = page.getByRole('button', { name: 'Cancel heat' });
  await cancelHeat.press('Enter');
  await page.getByLabel('Cancellation reason').fill('Accessibility path setup');
  await page.getByRole('button', { name: 'Confirm cancellation' }).press('Enter');
  await escapeDialog(page, page.getByRole('button', { name: 'Mark for rerun' }));

  await page.evaluate(() => localStorage.setItem('rr3:solo:demo:previous', JSON.stringify((window as any).RR3.getState())));
  await page.getByRole('button', { name: 'Settings' }).click();
  await escapeDialog(page, page.getByRole('button', { name: 'Restore previous save' }));
  await escapeDialog(page, page.getByRole('button', { name: 'Reset event' }));

  await importEvent(page, finalsEvent());
  await page.getByRole('button', { name: 'Finals' }).click();
  await escapeDialog(page, page.getByRole('button', { name: 'Manual selection with reason' }));
  await page.getByRole('button', { name: 'Include all tied cars' }).press('Enter');
  await page.getByRole('button', { name: 'Generate finals schedule' }).press('Enter');
  await escapeDialog(page, page.getByRole('button', { name: 'Generate finals schedule' }));
  await escapeDialog(page, page.getByRole('button', { name: 'Reset finals only' }));
  await escapeDialog(page, page.getByRole('button', { name: 'Manual champion decision' }));
});

test('fits all views and print routes at phone, tablet, desktop, and projector sizes', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(fileUrl);
  for (const width of [320, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of views) {
      await page.locator(`[data-view="${view}"]`).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${view} at ${width}px`).toBeLessThanOrEqual(width);
      await expect(page.locator('#view-content')).toBeVisible();
      const heading = await page.locator('main h2').first().boundingBox();
      expect(heading, `${view} heading at ${width}px`).not.toBeNull();
      expect(heading!.x, `${view} left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(heading!.x + heading!.width, `${view} right edge at ${width}px`).toBeLessThanOrEqual(width);
    }
  }

  await loadDemo(page);
  const long = `🏁 Žoë 東京 مرحبا ${'César-Lacsamana '.repeat(8)}`.slice(0, 200);
  const state = await page.evaluate((name) => {
    const value = (window as any).RR3.getState();
    delete value.activeView; delete value.theme;
    value.event.name = name;
    value.event.venue = name;
    value.event.organizer = name;
    value.participants[0].name = name;
    value.entries[0].name = name;
    return value;
  }, long);
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByLabel('Import event JSON').setInputFiles({ name: 'unicode.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  for (const width of [320, 768, 1280, 1920]) {
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width, height: 900 });
    for (const view of views) {
      await page.locator(`[data-view="${view}"]`).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${view} long text at ${width}px`).toBeLessThanOrEqual(width);
      await expect(page.locator('#view-content')).toBeVisible();
    }

    await page.locator('[data-view="reports"]').click();
    for (const route of printRoutes) {
      await page.emulateMedia({ media: 'screen' });
      await page.locator('#print-layout').selectOption(route);
      await page.getByRole('button', { name: 'Prepare print layout' }).press('Enter');
      await page.emulateMedia({ media: 'print' });
      const sheet = page.locator(`[data-print-sheet="${route}"]`);
      await expect(sheet).toBeVisible();
      const box = await sheet.boundingBox();
      expect(box, `${route} print sheet at ${width}px`).not.toBeNull();
      expect(box!.x, `${route} print left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${route} print right edge at ${width}px`).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${route} print width at ${width}px`).toBeLessThanOrEqual(width);
      expect(await page.locator('[data-print-controls]').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).display === 'none'))).toBe(true);
    }
  }
});

test('honors reduced motion, theme contrast smoke, and print visibility', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loadDemo(page);
  await page.getByRole('button', { name: 'Standings' }).click();
  expect(await page.locator('[data-rank-delta]').first().evaluate((node) => {
    const style = getComputedStyle(node);
    const seconds = (value: string) => value.endsWith('ms') ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
    return [style.animationDuration, style.transitionDuration].every((value) => seconds(value) <= 0.001);
  })).toBe(true);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    const ratio = await page.locator('body').evaluate((node) => {
      const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      const style = getComputedStyle(node); const foreground = parse(style.color); const background = parse(style.backgroundColor);
      const luminance = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    });
    expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
  }

  await page.getByRole('button', { name: 'Reports' }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.view-nav')).toHaveCSS('display', 'none');
  await expect(page.locator('.credit').first()).toBeVisible();
});

test('opens directly from file with zero network and console failures across all views', async ({ page }) => {
  const consoleErrors: string[] = []; const pageErrors: string[] = []; const requests: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith('file:')) requests.push(request.url()); });
  await page.goto(fileUrl);
  for (const view of views) await page.locator(`[data-view="${view}"]`).click();
  expect(requests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
