import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fileUrl = pathToFileURL(fileURLToPath(new URL('../../single-file/index.html', import.meta.url))).href;
const views = ['dashboard', 'registration', 'setup', 'live', 'standings', 'finals', 'reports', 'settings', 'diagnostics'];

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
  await page.getByRole('button', { name: 'Back' }).press('Enter');
  await expect(page.locator('[data-lane-card]').nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#live-heat-heading')).toBeFocused();
  await page.keyboard.press('u');
  await expect(page.getByRole('alert').filter({ hasText: 'Nothing to undo.' })).toBeVisible();
});

test('fits empty and long Unicode states at phone, tablet, desktop, and projector sizes', async ({ page }) => {
  await page.goto(fileUrl);
  for (const width of [320, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of views) {
      await page.locator(`[data-view="${view}"]`).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${view} at ${width}px`).toBeLessThanOrEqual(width);
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
  await page.setViewportSize({ width: 320, height: 900 });
  for (const view of views) {
    await page.locator(`[data-view="${view}"]`).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${view} long text`).toBeLessThanOrEqual(320);
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
