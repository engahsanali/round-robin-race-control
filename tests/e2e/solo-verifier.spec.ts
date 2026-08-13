import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const verifier = fileURLToPath(new URL('../../scripts/verify-single-file.mjs', import.meta.url));
const sourceDirectory = fileURLToPath(new URL('../../single-file/', import.meta.url));
const sourceHtml = await readFile(join(sourceDirectory, 'index.html'), 'utf8');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rr3-verifier-'));
  const directory = join(root, 'single-file');
  await cp(sourceDirectory, directory, { recursive: true });
  return { root, directory };
}

async function verify(directory: string) {
  try {
    const result = await execute(process.execPath, [verifier, '--directory', directory]);
    return { code: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error: any) {
    return { code: error.code ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('accepts only index.html plus root deployment metadata', async () => {
  const { root, directory } = await fixture();
  try {
    expect(await verify(directory)).toMatchObject({ code: 0 });
    await writeFile(join(directory, 'extra.txt'), 'companion');
    expect(await verify(directory)).toMatchObject({ code: 1 });
    await rm(join(directory, 'extra.txt'));
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'nested.js'), 'export default 1');
    const nested = await verify(directory);
    expect(nested.code).toBe(1);
    expect(nested.output).toMatch(/unexpected file or directory.*assets/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.describe('rejects companion-runtime references parsed from real tag attributes', () => {
  const mutations: Array<[string, string]> = [
    ['local image', '<img src="assets/photo.png" alt="race">'],
    ['source set', '<picture><source srcset="a.png 1x, b.png 2x"></picture>'],
    ['object data', '<object data="scoreboard.svg"></object>'],
    ['preload link', '<link rel="preload" href="app.js" as="script">'],
    ['mixed-case quoted script', "<ScRiPt data-note='>' SRC = 'app.js'></ScRiPt>"],
    ['CSS URL', '<style>.x { background: url(assets/track.png) }</style>'],
    ['CSS import', '<style>@import "theme.css";</style>'],
    ['dynamic source assignment', '<script>const image = document.createElement("img"); image.src = "track.png";</script>'],
    ['dynamic import', '<script>import("extra.js")</script>'],
    ['worker', '<script>new Worker("worker.js")</script>'],
  ];
  for (const [name, mutation] of mutations) test(name, async () => {
    const { root, directory } = await fixture();
    try {
      await writeFile(join(directory, 'index.html'), sourceHtml.replace('</head>', `${mutation}</head>`));
      const result = await verify(directory);
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/runtime|reference|network|worker|import|css/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test.describe('rejects static anchor navigation outside this standalone document', () => {
  for (const [name, href] of [
    ['remote HTTPS', 'https://example.test/results'],
    ['protocol relative', '//example.test/results'],
    ['JavaScript navigation', 'javascript:alert(1)'],
    ['data navigation', 'data:text/html,external'],
    ['local companion file', 'results.html'],
  ]) test(name, async () => {
    const { root, directory } = await fixture();
    try {
      await writeFile(join(directory, 'index.html'), sourceHtml.replace('</body>', `<a href="${href}">unsafe</a></body>`));
      const result = await verify(directory);
      expect(result.code).toBe(1);
      expect(result.output).toMatch(/anchor|navigation|runtime reference/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('allows empty and same-document fragment anchors', async () => {
    const { root, directory } = await fixture();
    try {
      await writeFile(join(directory, 'index.html'), sourceHtml.replace('</body>', '<a href="">same document</a><a href="#main-content">skip</a></body>'));
      expect(await verify(directory)).toMatchObject({ code: 0 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test('rejects a literal missing selector without accepting an unrelated object id', async () => {
  const { root, directory } = await fixture();
  try {
    const mutation = '<script>const arbitrary = { id: "missing-node" }; document.getElementById("missing-node"); document.querySelector("#also-missing");</script>';
    await writeFile(join(directory, 'index.html'), sourceHtml.replace('</body>', `${mutation}</body>`));
    const result = await verify(directory);
    expect(result.code).toBe(1);
    expect(result.output).toContain('#missing-node');
    expect(result.output).toContain('#also-missing');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.describe('validates literal selector structure rather than independent tokens', () => {
  for (const [name, mutation, selector] of [
    ['compound classes on separate elements', '<div class="shape-one"></div><div class="shape-two"></div>', '.shape-one.shape-two'],
    ['descendant classes on siblings', '<div id="shape-parent"></div><div class="shape-child"></div>', '#shape-parent .shape-child'],
    ['tag and class on different elements', '<section></section><div class="shape-card"></div>', 'section.shape-card'],
  ]) test(name, async () => {
    const { root, directory } = await fixture();
    try {
      const injected = `${mutation}<script>document.querySelector(${JSON.stringify(selector)});</script>`;
      await writeFile(join(directory, 'index.html'), sourceHtml.replace('</body>', `${injected}</body>`));
      const result = await verify(directory);
      expect(result.code).toBe(1);
      expect(result.output).toContain(selector);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
