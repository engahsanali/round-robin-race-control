import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../single-file/index.html', import.meta.url));
const fileUrl = pathToFileURL(htmlPath).href;

async function loadDemo(page: Page) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Load Demo Event' }).click();
  await page.getByRole('button', { name: 'Load separate demo' }).click();
}

test('runs every embedded group in isolation and preserves the live workspace', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await loadDemo(page);
  await page.getByRole('button', { name: 'Registration' }).click();

  const result = await page.evaluate(() => {
    const api = (window as any).RR3;
    const before = JSON.stringify(api.getState());
    const storageBefore = Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]));
    let returned: unknown;
    let thrown = '';
    try { returned = api.runAllTests(); } catch (error) { thrown = String(error); }
    return {
      before,
      after: JSON.stringify(api.getState()),
      storageBefore,
      storageAfter: Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])),
      returned,
      thrown,
    };
  });

  expect(result.thrown).toBe('');
  expect(result.after).toBe(result.before);
  expect(result.storageAfter).toEqual(result.storageBefore);
  expect(result.returned).toMatchObject({ failed: 0 });
  const suite = result.returned as { passed: number; failed: number; total: number; groups: Array<{ name: string; passed: number; failed: number; total: number; tests: unknown[] }> };
  expect(suite.total).toBeGreaterThanOrEqual(18);
  expect(suite.passed).toBe(suite.total);
  expect(suite.groups.map(({ name }) => name)).toEqual([
    'Schedules', 'Scoring', 'Ranking', 'Payments', 'Persistence / import',
    'CSV', 'Timing', 'Scheduler quality', 'Lane balance',
  ]);
  for (const group of suite.groups) {
    expect(group.total, group.name).toBeGreaterThanOrEqual(2);
    expect(group.passed, group.name).toBe(group.total);
    expect(group.failed, group.name).toBe(0);
    expect(group.tests).toHaveLength(group.total);
  }
  expect(pageErrors).toEqual([]);
});

test('renders grouped results, local facts, sanitized errors, integrity, and a copyable report', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Diagnostics' }).click();

  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Environment and recovery' })).toContainText('file:');
  await expect(page.getByRole('region', { name: 'Environment and recovery' })).toContainText(/browser-local storage/i);
  await expect(page.getByRole('region', { name: 'Environment and recovery' })).toContainText(/previous valid snapshot/i);
  await expect(page.getByRole('region', { name: 'Schedule integrity' })).toContainText(/valid/i);

  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'bad file:///C:/private/event.json\nsecret' })));
  await page.getByRole('button', { name: 'Diagnostics' }).click();
  const log = page.getByRole('region', { name: 'Sanitized diagnostic log' });
  await expect(log).toContainText('[location]');
  await expect(log).not.toContainText('C:/private');
  expect(await log.getByRole('listitem').first().textContent()).not.toMatch(/[\r\n\t]/);

  await page.getByRole('button', { name: 'Run embedded tests' }).click();
  await expect(page.getByRole('status', { name: 'Embedded test summary' })).toContainText(/passed.*failed.*total/i);
  await expect(page.locator('[data-test-group]')).toHaveCount(9);
  const report = page.getByLabel('Diagnostic report');
  await expect(report).toHaveAttribute('readonly', '');
  await expect(report).toHaveValue(/Round Robin Race Control diagnostic report/);
  await expect(report).toHaveValue(/Schedules: .* passed/);
  await expect(report).toHaveValue(/Schedule integrity:/);
  await page.getByRole('button', { name: 'Copy diagnostic report' }).click();
  await expect(page.locator('#save-status')).toContainText(/diagnostic report (copied|selected)/i);
});

test('shows the complete manual verification checklist', async ({ page }) => {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Diagnostics' }).click();
  await expect(page.getByRole('list', { name: 'Manual verification checklist' }).getByRole('listitem')).toHaveText([
    'Open the standalone file with network disabled and confirm zero requests or console errors.',
    'Navigate all nine views and verify empty, populated, and error states.',
    'Complete the event-day workflow using only the keyboard and documented shortcuts.',
    'Verify dialog focus return, Escape cancellation, and visible focus.',
    'Check 320 px, tablet, desktop, and projector layouts without page overflow.',
    'Enable reduced motion and confirm transitions and animations become effectively instant.',
    'Check light and dark theme contrast and confirm status is never communicated by color alone.',
    'Print every report route and confirm controls hide while creator credit remains visible.',
    'Test long and Unicode participant, car, event, venue, and organizer names.',
    'Export, import, restore the previous save, and retain a downloaded durable backup.',
  ]);
});
