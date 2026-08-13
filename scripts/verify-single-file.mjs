import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directoryArgument = process.argv.indexOf('--directory');
const runtimeDirectory = directoryArgument >= 0 ? resolve(process.argv[directoryArgument + 1] || '') : join(scriptRoot, 'single-file');
const htmlPath = join(runtimeDirectory, 'index.html');
const failures = [];
const failUnless = (condition, message) => { if (!condition) failures.push(message); };

async function inventory(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    found.push({ path, directory: entry.isDirectory() });
    if (entry.isDirectory()) found.push(...await inventory(join(directory, entry.name), path));
  }
  return found;
}

// Tokenizes start tags while honoring comments and quoted `>` characters. This
// is intentionally an HTML-aware scanner rather than a source-line regex.
function tokenizeStartTags(source) {
  const tags = [];
  const parents = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) break;
    if (source.startsWith('<!--', open)) { const close = source.indexOf('-->', open + 4); index = close < 0 ? source.length : close + 3; continue; }
    if (source[open + 1] === '/') {
      const close = source.indexOf('>', open + 2); const closingName = source.slice(open + 2, close < 0 ? source.length : close).trim().split(/\s/, 1)[0].toLowerCase();
      while (parents.length && tags[parents.at(-1)].name !== closingName) parents.pop();
      if (parents.length) parents.pop();
      index = close < 0 ? source.length : close + 1; continue;
    }
    if (/^<[!?]/.test(source.slice(open, open + 2))) { const close = source.indexOf('>', open + 2); index = close < 0 ? source.length : close + 1; continue; }
    let cursor = open + 1; while (/\s/.test(source[cursor] || '')) cursor += 1;
    const nameMatch = source.slice(cursor).match(/^[A-Za-z][\w:-]*/); if (!nameMatch) { index = open + 1; continue; }
    const name = nameMatch[0].toLowerCase(); cursor += nameMatch[0].length; const attributes = new Map();
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] || '')) cursor += 1;
      if (source[cursor] === '>') { cursor += 1; break; }
      if (source[cursor] === '/' && source[cursor + 1] === '>') { cursor += 2; break; }
      const attributeMatch = source.slice(cursor).match(/^[^\s=/>]+/); if (!attributeMatch) { cursor += 1; continue; }
      const attributeName = attributeMatch[0].toLowerCase(); cursor += attributeMatch[0].length; while (/\s/.test(source[cursor] || '')) cursor += 1; let value = '';
      if (source[cursor] === '=') {
        cursor += 1; while (/\s/.test(source[cursor] || '')) cursor += 1; const quote = source[cursor];
        if (quote === '"' || quote === "'") { cursor += 1; const end = source.indexOf(quote, cursor); value = source.slice(cursor, end < 0 ? source.length : end); cursor = end < 0 ? source.length : end + 1; }
        else { const valueMatch = source.slice(cursor).match(/^[^\s>]+/); value = valueMatch?.[0] || ''; cursor += value.length; }
      }
      attributes.set(attributeName, value);
    }
    const tagIndex = tags.length;
    tags.push({ name, attributes, start: open, end: cursor, parent: parents.at(-1) ?? null });
    if (!voidTags.has(name) && source[cursor - 2] !== '/') parents.push(tagIndex);
    index = cursor;
    if (name === 'script' || name === 'style') {
      const close = source.toLowerCase().indexOf(`</${name}`, index);
      if (close >= 0) index = close;
    }
  }
  return tags;
}

function isInlineReference(value) { const normalized = value.trim().toLowerCase(); return !normalized || normalized.startsWith('data:') || normalized.startsWith('#'); }
function simpleSelectorMatches(selector, shape) {
  const withoutPseudos = selector.replace(/:{1,2}[\w-]+(?:\([^)]*\))?/g, '');
  const tag = withoutPseudos.match(/^[A-Za-z][\w-]*/)?.[0]?.toLowerCase();
  if (tag && shape.name !== tag) return false;
  const ids = [...withoutPseudos.matchAll(/#([\w-]+)/g)].map((match) => match[1]);
  const classes = [...withoutPseudos.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  const attributes = [...withoutPseudos.matchAll(/\[\s*([\w:-]+)/g)].map((match) => match[1].toLowerCase());
  return ids.every((id) => shape.id === id) && classes.every((name) => shape.classes.has(name)) && attributes.every((name) => shape.attributes.has(name));
}
function staticSelectorExists(selector, shapes) {
  if (/[>+~]/.test(selector)) return false;
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const matchesChain = (shapeIndex, partIndex) => {
    if (!simpleSelectorMatches(parts[partIndex], shapes[shapeIndex])) return false;
    if (partIndex === 0) return true;
    let parent = shapes[shapeIndex].parent;
    while (parent !== null) { if (matchesChain(parent, partIndex - 1)) return true; parent = shapes[parent].parent; }
    return false;
  };
  return shapes.some((_, index) => matchesChain(index, parts.length - 1));
}

const contents = await inventory(runtimeDirectory);
const unexpected = contents.filter(({ path, directory }) => directory || !['index.html', 'netlify.toml'].includes(path));
failUnless(unexpected.length === 0, `Unexpected file or directory in single-file/: ${unexpected.map(({ path }) => path).join(', ') || 'none'}. Only index.html and root netlify.toml are permitted.`);
failUnless(contents.some(({ path }) => path === 'index.html'), 'single-file/index.html is missing.');
const html = await readFile(htmlPath, 'utf8');
const tags = tokenizeStartTags(html); const tagValues = (name) => tags.filter((tag) => tag.name === name);

failUnless((html.match(/Round Robin Race Control/g) || []).length >= 3, 'Product brand is missing or incomplete.');
failUnless((html.match(/Made by Cesar Lacsamana and Ahsan Ali/g) || []).length >= 3, 'Exact creator credit must appear in shell, reports, and diagnostics.');
const expectedViews = ['dashboard', 'registration', 'setup', 'live', 'standings', 'finals', 'reports', 'settings', 'diagnostics'];
const views = tagValues('button').map(({ attributes }) => attributes.get('data-view')).filter(Boolean);
failUnless(JSON.stringify(views) === JSON.stringify(expectedViews), `Expected exactly nine ordered views; found: ${views.join(', ')}`);

const presetTag = tagValues('script').find(({ attributes }) => attributes.get('id') === 'preset-data' && attributes.get('type')?.toLowerCase() === 'application/json');
if (!presetTag) failures.push('Inert preset data block is missing.');
else {
  const close = html.toLowerCase().indexOf('</script>', presetTag.end);
  try {
    const presets = JSON.parse(html.slice(presetTag.end, close));
    failUnless(JSON.stringify(Object.keys(presets)) === JSON.stringify(['template9', 'template12', 'template15', 'finals15']), 'Expected exactly four canonical presets.');
    failUnless([presets.template9?.length, presets.template12?.length, presets.template15?.length, presets.finals15?.length].join(',') === '4,5,6,5', 'Canonical preset match counts are incorrect.');
  } catch (error) { failures.push(`Preset data is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

failUnless(/\brunAllTests\s*\(/.test(html) && /run-embedded-tests/.test(html), 'Embedded self-test entry point is missing.');
failUnless(/@media\s+print\b/.test(html), 'Print CSS is missing.');
failUnless(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(html), 'Reduced-motion CSS is missing.');

const resourceAttributes = new Map([
  ['script', ['src']], ['img', ['src', 'srcset']], ['source', ['src', 'srcset']], ['video', ['src', 'poster']],
  ['audio', ['src']], ['track', ['src']], ['object', ['data']], ['embed', ['src']], ['iframe', ['src']],
  ['input', ['src']], ['form', ['action']],
]);
for (const tag of tags) {
  for (const attribute of resourceAttributes.get(tag.name) || []) {
    if (tag.attributes.has(attribute) && !isInlineReference(tag.attributes.get(attribute))) failures.push(`Runtime reference is forbidden: <${tag.name} ${attribute}="${tag.attributes.get(attribute)}">.`);
  }
  if (tag.name === 'link' && tag.attributes.has('href')) failures.push(`Runtime link reference is forbidden: rel="${tag.attributes.get('rel') || ''}" href="${tag.attributes.get('href')}".`);
  if (tag.name === 'a' && tag.attributes.has('href')) {
    const href = tag.attributes.get('href').trim().toLowerCase();
    if (href && !href.startsWith('#') && !href.startsWith('blob:')) failures.push(`Anchor navigation runtime reference is forbidden: href="${tag.attributes.get('href')}".`);
  }
  for (const [name] of tag.attributes) if (/^on[a-z]+$/.test(name)) failures.push(`Inline event handler ${name} is forbidden.`);
  const inlineStyle = tag.attributes.get('style'); if (inlineStyle && (/url\(\s*(?!["']?data:)/i.test(inlineStyle) || /@import\b/i.test(inlineStyle))) failures.push('CSS runtime reference is forbidden in a style attribute.');
}
const styleText = tagValues('style').map((tag) => html.slice(tag.end, html.toLowerCase().indexOf('</style>', tag.end))).join('\n');
failUnless(!/@import\b/i.test(styleText), 'CSS @import runtime reference is forbidden.');
failUnless(!/url\(\s*(?!["']?data:)/i.test(styleText), 'CSS url() runtime reference is forbidden unless it is an inline data URL.');

const forbiddenSource = [
  [/\beval\s*\(/, 'eval is forbidden.'], [/\bFunction\s*\(/, 'Function constructor is forbidden.'], [/document\.write\s*\(/, 'document.write is forbidden.'],
  [/(?:\.innerHTML|\.outerHTML|insertAdjacentHTML)\b/, 'Unsafe user-HTML sink is forbidden.'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'Network API is forbidden.'], [/navigator\.sendBeacon\s*\(/, 'Network beacon API is forbidden.'],
  [/\bimport\s*\(/, 'Dynamic import runtime reference is forbidden.'], [/\b(?:SharedWorker|Worker)\s*\(/, 'Worker runtime reference is forbidden.'], [/serviceWorker\s*\.\s*register\s*\(/, 'Service-worker runtime reference is forbidden.'],
  [/(?:\.\s*(?:src|href|srcset|data)|setAttribute\(\s*["'](?:src|href|srcset|data)["'])\s*(?:=|,)\s*["'](?!data:|#)/i, 'Dynamic runtime source assignment is forbidden.'],
  [/\b(?:TODO|FIXME|placeholder|starter|implement later|same as above|pseudocode)\b/i, 'Incomplete implementation marker is forbidden.'],
];
for (const [pattern, message] of forbiddenSource) failUnless(!pattern.test(html), message);

const ids = new Set(tags.map(({ attributes }) => attributes.get('id')).filter(Boolean));
const classes = new Set(tags.flatMap(({ attributes }) => (attributes.get('class') || '').split(/\s+/).filter(Boolean)));
const attributes = new Set(tags.flatMap((tag) => [...tag.attributes.keys()]));
const shapes = tags.map((tag) => ({ name: tag.name, id: tag.attributes.get('id') || null, classes: new Set((tag.attributes.get('class') || '').split(/\s+/).filter(Boolean)), attributes: new Set(tag.attributes.keys()), parent: tag.parent }));
for (const match of html.matchAll(/\belement\([^,]+,\s*\{[\s\S]{0,300}?attributes\s*:\s*\{[\s\S]{0,250}?\bid\s*:\s*["']([^"']+)["']/g)) ids.add(match[1]);
for (const match of html.matchAll(/\b(?:field|selectField)\([^,]+,\s*["']([^"']+)["']/g)) ids.add(match[1]);
for (const match of html.matchAll(/\bclassName\s*:\s*["'`]([^"'`$]+)["'`]/g)) {
  const names = match[1].split(/\s+/).filter(Boolean); names.forEach((name) => classes.add(name));
  shapes.push({ name: null, id: null, classes: new Set(names), attributes: new Set(), parent: null });
}
for (const match of html.matchAll(/["']([\w-]*data-[\w-]+)["']\s*:/g)) attributes.add(match[1]);
ids.forEach((id) => shapes.push({ name: null, id, classes: new Set(), attributes: new Set(), parent: null }));
attributes.forEach((name) => shapes.push({ name: null, id: null, classes: new Set(), attributes: new Set([name]), parent: null }));
for (const match of html.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) failUnless(ids.has(match[1]), `getElementById references undeclared selector #${match[1]}.`);
for (const match of html.matchAll(/querySelector(?:All)?\(\s*["']([^"']+)["']\s*\)/g)) {
  const selector = match[1];
  const alternatives = selector.split(',').map((value) => value.trim()).filter(Boolean);
  failUnless(alternatives.some((value) => staticSelectorExists(value, shapes)), `querySelector references unresolved structural selector ${selector}.`);
}

if (failures.length) {
  console.error(`Single-file verification failed (${failures.length}) for ${relative(scriptRoot, htmlPath) || basename(htmlPath)}:`);
  failures.forEach((failure) => console.error(`- ${failure}`)); process.exitCode = 1;
} else {
  console.log(`Single-file verification passed: ${htmlPath}`);
  console.log('Verified recursive artifact isolation, parsed runtime references, exact identity, views, presets, self-tests, selectors, accessibility CSS, and offline safety constraints.');
}
