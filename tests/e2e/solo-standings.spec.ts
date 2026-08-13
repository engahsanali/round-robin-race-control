import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fileUrl = pathToFileURL(fileURLToPath(new URL('../../single-file/index.html', import.meta.url))).href;

function standingsEvent(options: { mode?: 'competition' | 'dense' | 'ordinal'; tieBreaks?: string[]; noResults?: boolean } = {}) {
  const timestamp = '2026-08-14T00:00:00.000Z';
  const participants = ['Ada', 'Bea', 'Cleo', 'Dara', 'Withdrawn'].map((name, index) => ({ id: `person-${index + 1}`, name, email: '', phone: '', notes: '' }));
  const entries = participants.map((participant, index) => ({ id: `car-${index + 1}`, participantId: participant.id, carNumber: index + 1, name: `${participant.name} Arrow`, categoryId: index % 2 ? 'junior' : 'open', quantity: 1, active: index < 4 }));
  const heat = (id: string, matchNumber: number, heatNumber: number, lanes: [string, string, string], winner: string, times: [number, number, number]) => ({
    id, phase: 'preliminary', matchNumber, heatNumber, lanes, status: options.noResults ? 'scheduled' : 'completed', winnerEntryId: options.noResults ? null : winner, laneTimesMs: options.noResults ? [null, null, null] : times, notes: '',
  });
  return {
    version: 1,
    event: { id: 'event-standings', name: 'Ranking Proof Derby', date: '2026-08-14', venue: 'Cesar Circuit', organizer: 'Ahsan Ali', laneCount: 3, status: 'running', createdAt: timestamp, updatedAt: timestamp, resultSeal: 'provisional' },
    settings: { scheduleMode: 'custom', seed: 'ranking-proof', rankingMode: options.mode ?? 'competition', allowSharedRanks: options.mode !== 'ordinal', tieBreakOrder: options.tieBreaks ?? ['totalWins'], finalistCount: 2, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: { open: 1200, junior: 800 } },
    participants,
    entries,
    matches: [
      heat('m1-h1', 1, 1, ['car-1', 'car-2', 'car-3'], 'car-1', [900, 1200, 1000]),
      heat('m1-h2', 1, 2, ['car-4', 'car-2', 'car-3'], 'car-4', [1100, 1210, 990]),
      heat('m2-h1', 2, 1, ['car-1', 'car-2', 'car-4'], 'car-1', [880, 1190, 1080]),
      heat('m2-h2', 2, 2, ['car-3', 'car-2', 'car-4'], 'car-3', [970, 1180, 1090]),
    ],
    finals: [],
    payments: [{ id: 'pay-1', participantId: 'person-1', amountCents: 1200, kind: 'payment', paidAt: timestamp, note: 'Paid' }],
    auditLog: [],
  };
}

async function importEvent(page: Page, event: unknown) {
  await page.goto(fileUrl);
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByLabel('Import event JSON').setInputFiles({ name: 'standings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(event)) });
}

async function openStandings(page: Page, event: unknown) {
  await importEvent(page, event);
  await page.getByRole('button', { name: 'Standings', exact: true }).click();
}

test('projects competition and dense ranks from official preliminary results without an implicit car-number tie break', async ({ page }) => {
  await openStandings(page, standingsEvent());
  await expect(page.getByRole('table', { name: 'Preliminary standings' }).locator('tbody tr')).toHaveCount(4);
  expect(await page.locator('[data-standing-row]').evaluateAll((rows) => rows.map((row) => [row.getAttribute('data-car-id'), row.getAttribute('data-rank')]))).toEqual([
    ['car-1', '1'], ['car-3', '2'], ['car-4', '2'], ['car-2', '4'],
  ]);
  await expect(page.locator('[data-standing-row="car-5"]')).toHaveCount(0);
  await expect(page.locator('[data-standing-row="car-3"]')).toContainText('Unresolved tie');

  await openStandings(page, standingsEvent({ mode: 'dense' }));
  expect(await page.locator('[data-standing-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-rank')))).toEqual(['1', '2', '2', '3']);
});

test('uses only configured tie breaks, supports resolved ordinal ranks, and explains every comparison', async ({ page }) => {
  await openStandings(page, standingsEvent({ mode: 'ordinal', tieBreaks: ['totalWins', 'averageTime', 'carNumber'] }));
  expect(await page.locator('[data-standing-row]').evaluateAll((rows) => rows.map((row) => [row.getAttribute('data-car-id'), row.getAttribute('data-rank')]))).toEqual([
    ['car-1', '1'], ['car-3', '2'], ['car-4', '3'], ['car-2', '4'],
  ]);
  await page.getByRole('button', { name: 'Why this rank? Cleo Arrow' }).click();
  const proof = page.getByRole('region', { name: 'Rank proof for Cleo Arrow' });
  await expect(proof).toContainText(/Total Wins: 1 — equal/i);
  await expect(proof).toContainText(/Average Time: 986\.67 ms — resolved this rank/i);
  await expect(proof).not.toContainText(/car number.*resolved/i);

  await openStandings(page, standingsEvent({ mode: 'ordinal', tieBreaks: ['totalWins'] }));
  await expect(page.locator('#view-content [role="alert"]')).toContainText('Ordinal ranking requires configured tie breaks to resolve every tie');
  await expect(page.getByText(/stable ID.*competitive/i)).toHaveCount(0);
});

test('shows no leader or podium before an official result and keeps a persistent non-color rank delta after results', async ({ page }) => {
  await openStandings(page, standingsEvent({ noResults: true }));
  await expect(page.getByText('No leader until an official result exists.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Podium' })).toContainText('Podium opens after the first official result.');
  await expect(page.locator('[data-podium-place]')).toHaveCount(0);
  await expect(page.locator('[data-standing-row]').first()).toHaveAttribute('data-rank', '');

  await openStandings(page, standingsEvent());
  const delta = page.locator('[data-standing-row="car-1"] [data-rank-delta]');
  await expect(delta).toHaveText('New at rank 1');
  const duration = await delta.evaluate((node) => Number.parseFloat(getComputedStyle(node).animationDuration) * 1000);
  expect(duration).toBeGreaterThanOrEqual(180);
  expect(duration).toBeLessThanOrEqual(240);
  await page.getByRole('button', { name: 'Reports' }).click();
  await page.getByRole('button', { name: 'Standings', exact: true }).click();
  await expect(page.locator('[data-standing-row="car-1"] [data-rank-delta]')).toHaveText('No rank change');
});

test('renders the complete analytical story with inline graphics, takeaways, tables, and non-color labels', async ({ page }) => {
  await importEvent(page, standingsEvent());
  const expected: Array<[string, 'Dashboard' | 'Standings' | 'Finals']> = [
    ['Event completion', 'Dashboard'], ['Category mix', 'Dashboard'], ['Payment status', 'Dashboard'],
    ['Win distribution', 'Standings'], ['Cumulative wins by match', 'Standings'], ['Lane balance', 'Standings'],
    ['Opponent repeat matrix', 'Standings'], ['Podium', 'Standings'], ['Finals qualification cutoff', 'Finals'],
  ];
  for (const [title, view] of expected) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const chart = page.locator(`[data-chart="${title}"]`);
    await expect(chart.getByRole('heading', { name: title })).toBeVisible();
    await expect(chart.locator('[data-chart-takeaway]')).not.toBeEmpty();
    await expect(chart.locator(`table[aria-label="${title} data"]`)).toBeAttached();
    await expect(chart.locator('svg, canvas')).toHaveCount(1);
    await expect(chart.locator('[data-status-text]')).not.toBeEmpty();
  }
  await page.setViewportSize({ width: 320, height: 780 });
  await page.getByRole('button', { name: 'Standings' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('uses value-correct chart geometry, match-by-match cumulative series, scheduled lane stacks, and a full opponent matrix', async ({ page }) => {
  const event = standingsEvent() as any;
  event.matches[1].status = 'scheduled'; event.matches[1].winnerEntryId = null; event.matches[1].laneTimesMs = [null, null, null];
  event.matches[2].status = 'scheduled'; event.matches[2].winnerEntryId = null; event.matches[2].laneTimesMs = [null, null, null];
  event.matches[3].status = 'scheduled'; event.matches[3].winnerEntryId = null; event.matches[3].laneTimesMs = [null, null, null];
  await importEvent(page, event);
  await page.getByRole('button', { name: 'Dashboard' }).click();
  const completion = await page.locator('[data-chart="Event completion"] svg').evaluate((svg) => ({ completed: svg.getAttribute('data-completed'), total: svg.getAttribute('data-total'), share: svg.querySelector('[data-series-label="Completed"]')?.getAttribute('data-share') }));
  expect(completion).toEqual({ completed: '1', total: '4', share: '0.25' });

  const categoryShares = await page.locator('[data-chart="Category mix"] [data-series-label]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-share'))));
  expect(categoryShares.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 8);
  await page.getByRole('button', { name: 'Standings', exact: true }).click();
  expect(await page.locator('[data-chart="Cumulative wins by match"] [data-series="Ada Arrow"]').getAttribute('data-values')).toBe('[1,1]');
  expect(await page.locator('[data-chart="Cumulative wins by match"] [data-series="Cleo Arrow"]').getAttribute('data-values')).toBe('[0,0]');

  const adaLaneValues = await page.locator('[data-chart="Lane balance"] [data-series="Ada Arrow"] [data-lane]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-value'))));
  expect(adaLaneValues).toEqual([2, 0, 0]);
  await expect(page.locator('[data-chart="Opponent repeat matrix"] [data-matrix-cell]')).toHaveCount(16);
  await expect(page.locator('[data-chart="Opponent repeat matrix"] table[aria-label="Opponent repeat matrix data"] thead th')).toHaveCount(5);
});

test('podium retains every entrant sharing a top-three competitive rank', async ({ page }) => {
  const event = standingsEvent() as any;
  event.participants.push({ id: 'person-6', name: 'Eli', email: '', phone: '', notes: '' });
  event.entries.push({ id: 'car-6', participantId: 'person-6', carNumber: 6, name: 'Eli Arrow', categoryId: 'open', quantity: 1, active: true });
  event.matches.push({ id: 'm3-h1', phase: 'preliminary', matchNumber: 3, heatNumber: 1, lanes: ['car-6', 'car-2', 'car-4'], status: 'completed', winnerEntryId: 'car-6', laneTimesMs: [960, 1180, 1090], notes: '' });
  await openStandings(page, event);
  const podiumNames = await page.locator('[data-chart="Podium"] [data-podium-place]').allTextContents();
  expect(podiumNames).toEqual(expect.arrayContaining(['#1Ada ArrowPlaced', '#2Cleo ArrowTied place', '#2Dara ArrowTied place', '#2Eli ArrowTied place']));
  expect(podiumNames).toHaveLength(4);
});

test('clips long opponent matrix labels inside the SVG while preserving full accessible table names', async ({ page }) => {
  const event = standingsEvent() as any;
  event.entries[0].name = `Ada ${'Extraordinarily Long Opponent Identity '.repeat(5)}`.slice(0, 200);
  await openStandings(page, event);
  const label = page.locator('[data-chart="Opponent repeat matrix"] [data-matrix-label="car-1"]');
  await expect(label).toHaveAttribute('textLength', '136');
  await expect(label).toHaveAttribute('lengthAdjust', 'spacingAndGlyphs');
  await expect(page.locator('[data-chart="Opponent repeat matrix"] table')).toContainText(event.entries[0].name);
});

test('makes analytical movement instant when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStandings(page, standingsEvent());
  const duration = await page.locator('[data-rank-delta]').first().evaluate((node) => Number.parseFloat(getComputedStyle(node).animationDuration) * 1000);
  expect(duration).toBeLessThanOrEqual(1);
});
