import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELEASE_VERSION = "0.1.0";

async function filesWithin(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithin(path));
    else files.push(path);
  }
  return files;
}

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

export async function verifyProBuild(repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const proRoot = join(repositoryRoot, "apps", "pro");
  const distRoot = join(proRoot, "dist");
  const failures = [];
  const requireCondition = (condition, message) => { if (!condition) failures.push(message); };
  const readJson = async (path, label) => {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch (cause) { failures.push(`${label} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); return null; }
  };

  const packageJson = await readJson(join(proRoot, "package.json"), "Pro package");
  const rootPackageJson = await readJson(join(repositoryRoot, "package.json"), "Root package");
  const manifest = await readJson(join(distRoot, "manifest.webmanifest"), "Built manifest");
  requireCondition(packageJson?.version === RELEASE_VERSION, `Expected exact Pro release version ${RELEASE_VERSION}; found ${packageJson?.version ?? "missing"}.`);
  requireCondition(rootPackageJson?.version === RELEASE_VERSION, `Expected exact repository release version ${RELEASE_VERSION}; found ${rootPackageJson?.version ?? "missing"}.`);

  const distFiles = await filesWithin(distRoot);
  const relativeFiles = distFiles.map((path) => relative(distRoot, path).replaceAll("\\", "/"));
  const textFiles = distFiles.filter((path) => [".html", ".js", ".css", ".svg", ".json", ".webmanifest", ".txt"].includes(extname(path)) || path.endsWith("sw.js"));
  const builtTextParts = await Promise.all(textFiles.map(async (path) => ({ path: relative(distRoot, path), text: await readFile(path, "utf8") })));
  const builtText = builtTextParts.map(({ text }) => text).join("\n");
  const indexHtml = await readFile(join(distRoot, "index.html"), "utf8");
  const netlify = await readFile(join(proRoot, "netlify.toml"), "utf8");

  for (const required of ["index.html", "manifest.webmanifest", "sw.js", "icons/rr3-192.svg", "icons/rr3-512.svg"]) requireCondition(relativeFiles.includes(required), `Required production asset is missing: ${required}.`);
  requireCondition(relativeFiles.some((path) => /^workbox-[\w-]+\.js$/.test(path)), "Generated Workbox runtime is missing.");
  requireCondition(relativeFiles.some((path) => /^assets\/index-[\w-]+\.js$/.test(path)), "Hashed application JavaScript asset is missing.");
  requireCondition(relativeFiles.some((path) => /^assets\/index-[\w-]+\.css$/.test(path)), "Hashed application CSS asset is missing.");
  requireCondition(!relativeFiles.some((path) => path.endsWith(".map")), "Production output must not contain source maps.");

  requireCondition(indexHtml.includes("<title>Round Robin Race Control Pro</title>"), "Production title is missing or incorrect.");
  requireCondition(indexHtml.includes('property="og:title" content="Round Robin Race Control Pro"'), "Open Graph title metadata is missing.");
  requireCondition(indexHtml.includes('property="og:description"'), "Open Graph description metadata is missing.");
  requireCondition(indexHtml.includes('rel="manifest" href="/manifest.webmanifest"'), "Manifest link is missing.");

  requireCondition(manifest?.name === "Round Robin Race Control Pro", "Manifest product name is incorrect.");
  requireCondition(manifest?.short_name === "RR·3 Pro", "Manifest short name is incorrect.");
  requireCondition(manifest?.display === "standalone", "Manifest must use standalone display mode.");
  requireCondition(manifest?.start_url === "/" && manifest?.scope === "/", "Manifest start URL and scope must cover deep application routes.");
  requireCondition(Array.isArray(manifest?.icons) && manifest.icons.length >= 2, "Manifest requires local 192 and 512 brand icons.");
  for (const icon of manifest?.icons ?? []) {
    const iconPath = typeof icon.src === "string" ? icon.src.replace(/^\//, "") : "";
    requireCondition(Boolean(iconPath) && await exists(join(distRoot, iconPath)), `Manifest icon is missing from output: ${icon.src ?? "undefined"}.`);
    requireCondition(!/^https?:\/\//i.test(icon.src ?? ""), `Manifest icon must be local: ${icon.src}.`);
  }

  for (const route of ["/registration", "/schedule", "/race", "/standings", "/finals", "/reports", "/settings", "/diagnostics", "/present"]) requireCondition(builtText.includes(route), `Compiled application route is missing: ${route}.`);
  requireCondition(builtText.includes("Made by Cesar Lacsamana and Ahsan Ali"), "Exact creator credit is missing from compiled content.");
  requireCondition(builtText.includes(RELEASE_VERSION), `Exact release version ${RELEASE_VERSION} is missing from compiled content.`);
  requireCondition(builtText.includes("same browser and device") && builtText.includes("not cloud or cross-device"), "The compiled spectator limitation must explicitly reject cloud or cross-device sync claims.");
  requireCondition(!/(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[0-9A-Za-z]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(builtText), "Production output contains a credential-like secret.");
  requireCondition(!/\b(?:TODO|FIXME|implement later|starter app|lorem ipsum)\b/i.test(builtText), "Production output contains an incomplete or starter marker.");

  for (const { path, text } of builtTextParts) {
    if (/(?:\b(?:import|from)\s*\(?\s*["']https?:\/\/|\b(?:fetch|Worker|SharedWorker)\s*\(\s*["']https?:\/\/|(?:src|href)\s*=\s*["']https?:\/\/|@import\s+(?:url\()?\s*["']?https?:\/\/|url\(\s*["']?https?:\/\/)/i.test(text)) failures.push(`Compiled asset contains a remote runtime reference: ${path}.`);
    if (/\beval\s*\(|\b(?:new\s+)?Function\s*\(|\bdocument\.write\s*\(/.test(text)) failures.push(`Compiled asset contains an unsafe runtime API: ${path}.`);
    if (/<[a-z][^>]*\son(?:click|load|error|submit|change|input|keydown|keyup)\s*=/i.test(text)) failures.push(`Compiled asset contains an inline event handler: ${path}.`);
  }

  const netlifyRequirements = [
    [/\[\[redirects\]\][\s\S]*from\s*=\s*"\/\*"[\s\S]*to\s*=\s*"\/index\.html"[\s\S]*status\s*=\s*200/, "Netlify SPA fallback redirect is missing."],
    [/Content-Security-Policy\s*=\s*"[^"]*default-src 'self'[^"]*style-src-attr 'unsafe-inline'[^"]*object-src 'none'[^"]*frame-ancestors 'none'[^"]*"/, "Restrictive Content-Security-Policy with constrained runtime style attributes is missing."],
    [/Strict-Transport-Security\s*=\s*"max-age=63072000; includeSubDomains; preload"/, "Strict transport security header is missing."],
    [/Referrer-Policy\s*=\s*"no-referrer"/, "Referrer policy header is missing."],
    [/X-Content-Type-Options\s*=\s*"nosniff"/, "Content type protection header is missing."],
    [/Permissions-Policy\s*=\s*"[^"]*camera=\(\)[^"]*microphone=\(\)[^"]*"/, "Restrictive permissions policy is missing."],
    [/for\s*=\s*"\/sw\.js"[\s\S]*Cache-Control\s*=\s*"no-cache"/, "Service-worker no-cache header is missing."],
  ];
  for (const [pattern, message] of netlifyRequirements) requireCondition(pattern.test(netlify), message);
  return { failures, distRoot, releaseVersion: RELEASE_VERSION };
}

async function runCli() {
  const result = await verifyProBuild();
  if (result.failures.length) {
    console.error(`Pro production verification failed (${result.failures.length}):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`Pro production verification passed: ${result.distRoot}`);
    console.log(`Verified release ${result.releaseVersion}, routes, PWA shell, local icons, exact credit, metadata, prohibited runtime absence, SPA fallback, and security headers.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCli();
