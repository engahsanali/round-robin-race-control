import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../single-file/index.html', import.meta.url));
const fixturePath = fileURLToPath(new URL('../../fixtures/schedules.json', import.meta.url));
const fileUrl = pathToFileURL(htmlPath).href;

test('opens the standalone shell locally without runtime failures or external requests', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const externalRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  page.on('request', (request) => {
    if (!request.url().startsWith('file:')) externalRequests.push(request.url());
  });

  await page.goto(fileUrl);

  await expect(page).toHaveTitle('Round Robin Race Control — Solo');
  await expect(page.getByRole('heading', { level: 1, name: 'Round Robin Race Control' })).toBeVisible();
  await expect(page.getByText('RR · 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Solo', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Made by Cesar Lacsamana and Ahsan Ali', { exact: true })).toBeVisible();
  await expect(page.getByText('No event loaded', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load Demo Event' })).toBeVisible();
  await expect(page.getByText(/data stays in this browser/i)).toBeVisible();
  await expect(page.getByText(/local-file storage is best effort/i)).toBeVisible();
  await expect(page.getByText(/durable backup.*arrives later/i)).toBeVisible();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('provides nine keyboard-reachable views and accessible shell surfaces', async ({ page }) => {
  await page.goto(fileUrl);

  await expect(page.locator('header')).toHaveCount(1);
  await expect(page.locator('nav')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('footer')).toHaveCount(1);
  await expect(page.locator('a[href="#main-content"]')).toHaveText('Skip to main content');

  const expectedViews = [
    'dashboard', 'registration', 'setup', 'live', 'standings',
    'finals', 'reports', 'settings', 'diagnostics',
  ];
  expect(await page.locator('nav [data-view]').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-view')),
  )).toEqual(expectedViews);

  for (const view of expectedViews) {
    const button = page.locator(`[data-view="${view}"]`);
    await button.focus();
    await expect(button).toBeFocused();
    await button.press('Enter');
    await expect(page.locator('main')).toHaveAttribute('data-active-view', view);
  }

  const focused = page.locator('[data-view="diagnostics"]');
  expect(await focused.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveCount(1);
  await expect(page.locator('[role="alert"][aria-live="assertive"]')).toHaveCount(1);
  await expect(page.locator('dialog')).toHaveCount(1);
  await expect(page.locator('input[type="file"]')).toBeHidden();
});

test('persists light, dark, and system themes and follows platform color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(fileUrl);

  const theme = page.getByLabel('Theme');
  await expect(theme.locator('option')).toHaveText(['System', 'Light', 'Dark']);
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('rr3:theme'))).toBe('dark');

  await page.reload();
  await expect(theme).toHaveValue('dark');
  await theme.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('rr3:theme'))).toBe('system');
});

test('embeds exact inert presets and exposes a safe read-only diagnostic API', async ({ page }) => {
  const canonical = JSON.parse(await readFile(fixturePath, 'utf8'));
  await page.goto(fileUrl);

  expect(await page.locator('#preset-data').getAttribute('type')).toBe('application/json');
  expect(JSON.parse(await page.locator('#preset-data').textContent() ?? '{}')).toEqual(canonical);

  const diagnostic = await page.evaluate(() => {
    const api = (window as unknown as { RR3: {
      version: string;
      getState(): unknown;
      runAllTests(): unknown;
    } }).RR3;
    return {
      frozen: Object.isFrozen(api),
      keys: Object.keys(api).sort(),
      version: api.version,
      state: api.getState(),
      tests: api.runAllTests(),
    };
  });
  expect(diagnostic.frozen).toBe(true);
  expect(diagnostic.keys).toEqual(['getState', 'runAllTests', 'version']);
  expect(diagnostic.version).toBe('1.0.0');
  expect(diagnostic.state).toMatchObject({ event: null, participants: [], heats: [], results: [] });
  expect(diagnostic.tests).toEqual({ passed: 0, failed: 0, total: 0, groups: [] });
});

test('contains no external runtime assets, unsafe handlers, or forbidden JavaScript APIs', async () => {
  const html = await readFile(htmlPath, 'utf8');
  expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
  expect(html).not.toMatch(/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i);
  expect(html).not.toMatch(/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']https?:/i);
  expect(html).not.toMatch(/url\(\s*["']?https?:/i);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/\beval\s*\(/);
  expect(html).not.toMatch(/\bFunction\s*\(/);
  expect(html).not.toMatch(/document\.write\s*\(/);
  expect(html).not.toMatch(/TODO|FIXME|starter|pseudocode/i);
  expect(html).toContain('@media print');
  expect(html).toContain('prefers-reduced-motion');
});

test('keeps race controls touch-ready and the shell usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(fileUrl);

  const demoBox = await page.getByRole('button', { name: 'Load Demo Event' }).boundingBox();
  expect(demoBox?.height).toBeGreaterThanOrEqual(48);
  const nav = page.locator('nav');
  expect(await nav.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await nav.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto');
  await page.locator('[data-view="live"]').click();
  await expect(page.locator('[data-live-dock]')).toHaveCSS('position', 'sticky');
});
