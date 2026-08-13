import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDirectory = join(repositoryRoot, 'single-file');
const htmlPath = join(runtimeDirectory, 'index.html');
const failures = [];
const requireCondition = (condition, message) => { if (!condition) failures.push(message); };
const html = await readFile(htmlPath, 'utf8');
const runtimeExtensions = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.wasm']);
const runtimeFiles = (await readdir(runtimeDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && runtimeExtensions.has(extname(entry.name).toLowerCase()))
  .map((entry) => entry.name).sort();

requireCondition(runtimeFiles.length === 1 && runtimeFiles[0] === 'index.html', `Expected index.html to be the only runtime file; found: ${runtimeFiles.join(', ') || 'none'}`);
requireCondition((html.match(/Round Robin Race Control/g) || []).length >= 3, 'Product brand is missing or incomplete.');
requireCondition((html.match(/Made by Cesar Lacsamana and Ahsan Ali/g) || []).length >= 3, 'Exact creator credit must appear in shell, reports, and diagnostics.');

const expectedViews = ['dashboard', 'registration', 'setup', 'live', 'standings', 'finals', 'reports', 'settings', 'diagnostics'];
const views = [...html.matchAll(/<button\b[^>]*\bdata-view="([^"]+)"/gi)].map((match) => match[1]);
requireCondition(JSON.stringify(views) === JSON.stringify(expectedViews), `Expected exactly nine ordered views; found: ${views.join(', ')}`);

const presetBlock = html.match(/<script\s+type="application\/json"\s+id="preset-data">([\s\S]*?)<\/script>/i);
if (!presetBlock) failures.push('Inert preset data block is missing.');
else {
  try {
    const presets = JSON.parse(presetBlock[1]);
    requireCondition(JSON.stringify(Object.keys(presets)) === JSON.stringify(['template9', 'template12', 'template15', 'finals15']), 'Expected exactly four canonical presets.');
    requireCondition([presets.template9?.length, presets.template12?.length, presets.template15?.length, presets.finals15?.length].join(',') === '4,5,6,5', 'Canonical preset match counts are incorrect.');
  } catch (error) { failures.push(`Preset data is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

requireCondition(/\brunAllTests\s*\(/.test(html) && /run-embedded-tests/.test(html), 'Embedded self-test entry point is missing.');
requireCondition(/@media\s+print\b/.test(html), 'Print CSS is missing.');
requireCondition(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(html), 'Reduced-motion CSS is missing.');

const forbiddenPatterns = [
  [/<script\b[^>]*\bsrc\s*=/i, 'External script source is forbidden.'],
  [/<link\b[^>]*\brel\s*=\s*["']?stylesheet/i, 'External stylesheet is forbidden.'],
  [/<(?:img|source|video|audio|iframe)\b[^>]*\bsrc\s*=\s*["']?https?:/i, 'Remote media source is forbidden.'],
  [/<(?:a|form)\b[^>]*\b(?:href|action)\s*=\s*["']?https?:/i, 'Remote navigation or form action is forbidden.'],
  [/url\(\s*["']?https?:/i, 'Remote CSS URL is forbidden.'],
  [/\son[a-z]+\s*=/i, 'Inline event handlers are forbidden.'],
  [/\beval\s*\(/, 'eval is forbidden.'],
  [/\bFunction\s*\(/, 'Function constructor is forbidden.'],
  [/document\.write\s*\(/, 'document.write is forbidden.'],
  [/(?:\.innerHTML|\.outerHTML|insertAdjacentHTML)\b/, 'Unsafe user-HTML sink is forbidden.'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'Network API is forbidden in the standalone runtime.'],
  [/navigator\.sendBeacon\s*\(/, 'Network beacon API is forbidden in the standalone runtime.'],
  [/\b(?:TODO|FIXME|placeholder|starter|implement later|same as above|pseudocode)\b/i, 'Incomplete implementation marker is forbidden.'],
];
for (const [pattern, message] of forbiddenPatterns) requireCondition(!pattern.test(html), message);

const declaredIds = new Set([
  ...[...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
  ...[...html.matchAll(/\bid\s*:\s*["']([^"']+)["']/g)].map((match) => match[1]),
  ...[...html.matchAll(/\b(?:field|selectField)\([^,]+,\s*["']([^"']+)["']/g)].map((match) => match[1]),
]);
const referencedIds = [...html.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
for (const id of new Set(referencedIds)) requireCondition(declaredIds.has(id), `getElementById references undeclared selector #${id}.`);

const selectorReferences = [...html.matchAll(/querySelector(?:All)?\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
for (const selector of new Set(selectorReferences)) {
  const identifiers = [...selector.matchAll(/([.#])([a-zA-Z_][\w-]*)|\[([\w-]+)/g)];
  for (const identifier of identifiers) {
    const token = identifier[2] || identifier[3];
    requireCondition(html.split(token).length > 2, `querySelector references missing selector token ${token}.`);
  }
}

requireCondition(!/<script\b[^>]*\btype\s*=\s*["']module["']/i.test(html), 'Module scripts can introduce companion runtime dependencies.');
requireCondition(!/\bimport\s+(?:[^('";]+\s+from\s+)?["'][.\/]/.test(html), 'Relative runtime imports are forbidden.');

if (failures.length) {
  console.error(`Single-file verification failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Single-file verification passed: ${htmlPath}`);
  console.log('Verified one runtime HTML, exact identity, nine views, four presets, self-tests, accessibility CSS, selector integrity, and offline safety constraints.');
}
