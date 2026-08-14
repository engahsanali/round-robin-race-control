import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { verifyMeetMigrations } from "./verify-meet-migrations.mjs";

const RELEASE_VERSION = "0.1.0";
const CANONICAL_URL = "https://round-robin-race-control-meet.netlify.app/";
const execute = promisify(execFile);
const credentialPattern = /(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[0-9A-Za-z]{20,}|sb_secret_[0-9A-Za-z_-]{20,}|sbp_[0-9A-Za-z_-]{20,}|nfp(?:at)?_[0-9A-Za-z_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:service_role|NETLIFY_AUTH_TOKEN|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|POSTGRES_PASSWORD|DATABASE_PASSWORD|DB_PASSWORD)\s*[:=]\s*["']?[0-9A-Za-z_./+=-]{12,}|postgres(?:ql)?:\/\/[^\s:/@]+:[^\s/@]+@)/i;
const jwtPattern = /eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{16,}/g;

function containsCredential(text) {
  if (credentialPattern.test(text)) return true;
  for (const token of text.match(jwtPattern) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      if (payload?.role === "service_role") return true;
    } catch { /* Invalid JWT-shaped text is not itself a secret. */ }
  }
  return false;
}

async function filesWithin(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesWithin(path));
    else files.push(path);
  }
  return files;
}

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function safeFiles(directory) {
  try { return await filesWithin(directory); } catch { return []; }
}

export async function verifyMeetBuild(repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const meetRoot = join(repositoryRoot, "apps", "meet");
  const distRoot = join(meetRoot, "dist");
  const failures = [];
  const requireCondition = (condition, message) => { if (!condition) failures.push(message); };
  const readText = async (path, label) => {
    try { return await readFile(path, "utf8"); }
    catch (cause) { failures.push(`${label} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`); return ""; }
  };
  const readJson = async (path, label) => {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch (cause) { failures.push(`${label} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); return null; }
  };

  const packageJson = await readJson(join(meetRoot, "package.json"), "Meet package");
  const rootPackageJson = await readJson(join(repositoryRoot, "package.json"), "Root package");
  const manifest = await readJson(join(distRoot, "manifest.webmanifest"), "Built manifest");
  const indexHtml = await readText(join(distRoot, "index.html"), "Built index");
  const netlify = await readText(join(meetRoot, "netlify.toml"), "Meet Netlify config");
  const supabaseConfig = await readText(join(repositoryRoot, "supabase", "config.toml"), "Supabase local config");
  requireCondition(packageJson?.version === RELEASE_VERSION, `Expected exact Meet release version ${RELEASE_VERSION}; found ${packageJson?.version ?? "missing"}.`);
  requireCondition(rootPackageJson?.version === RELEASE_VERSION, `Expected exact repository release version ${RELEASE_VERSION}; found ${rootPackageJson?.version ?? "missing"}.`);

  const distFiles = await safeFiles(distRoot);
  const relativeFiles = distFiles.map((path) => relative(distRoot, path).replaceAll("\\", "/"));
  const textFiles = distFiles.filter((path) => [".html", ".js", ".css", ".svg", ".json", ".webmanifest", ".txt"].includes(extname(path)));
  const textParts = await Promise.all(textFiles.map(async (path) => ({ path: relative(distRoot, path).replaceAll("\\", "/"), text: await readFile(path, "utf8") })));
  const builtText = textParts.map(({ text }) => text).join("\n");
  for (const required of ["index.html", "manifest.webmanifest", "icons/meet-192.svg", "icons/meet-512.svg", "social-card.svg"]) requireCondition(relativeFiles.includes(required), `Required production asset is missing: ${required}.`);
  requireCondition(relativeFiles.some((path) => /^assets\/index-[\w-]+\.js$/.test(path)), "Hashed Meet application JavaScript asset is missing.");
  requireCondition(relativeFiles.some((path) => /^assets\/index-[\w-]+\.css$/.test(path)), "Hashed Meet application CSS asset is missing.");
  requireCondition(!relativeFiles.some((path) => path.endsWith(".map")), "Production output must not contain source maps.");

  requireCondition(indexHtml.includes("<title>Round Robin Race Control Meet Edition</title>"), "Production title is missing or incorrect.");
  requireCondition(/<meta\s+name="description"\s+content="[^"]+"/i.test(indexHtml), "Production description metadata is missing.");
  requireCondition(indexHtml.includes(`rel="canonical" href="${CANONICAL_URL}"`), "Canonical Meet URL is missing or incorrect.");
  requireCondition(indexHtml.includes('property="og:title" content="Round Robin Race Control Meet Edition"'), "Open Graph title metadata is missing.");
  requireCondition(indexHtml.includes("property=\"og:description\""), "Open Graph description metadata is missing.");
  requireCondition(indexHtml.includes(`property="og:image" content="${CANONICAL_URL}social-card.svg"`), "Open Graph social image is missing or not canonical.");
  requireCondition(indexHtml.includes('rel="manifest" href="/manifest.webmanifest"'), "Manifest link is missing.");
  requireCondition(indexHtml.includes('rel="icon" href="/icons/meet-192.svg"'), "Local Meet favicon is missing.");

  requireCondition(manifest?.name === "Round Robin Race Control Meet Edition", "Manifest product name is incorrect.");
  requireCondition(manifest?.short_name === "RR·3 Meet", "Manifest short name is incorrect.");
  requireCondition(manifest?.display === "standalone", "Manifest must use standalone display mode.");
  requireCondition(manifest?.id === "/" && manifest?.start_url === "/" && manifest?.scope === "/", "Manifest identity, start URL and scope must cover the root workspace.");
  requireCondition(Array.isArray(manifest?.icons) && manifest.icons.length >= 2, "Manifest requires local 192 and 512 Meet icons.");
  for (const icon of manifest?.icons ?? []) {
    const iconPath = typeof icon.src === "string" ? icon.src.replace(/^\//, "") : "";
    requireCondition(Boolean(iconPath) && await exists(join(distRoot, iconPath)), `Manifest icon is missing from output: ${icon.src ?? "undefined"}.`);
    requireCondition(!/^https?:\/\//i.test(icon.src ?? ""), `Manifest icon must be local: ${icon.src}.`);
  }

  requireCondition(builtText.includes("Made by Cesar Lacsamana and Ahsan Ali"), "Exact creator credit is missing from compiled Meet content.");
  for (const phrase of [RELEASE_VERSION, "Explore local read-only demo", "Open official workspace", "No advertising trackers.", "Backup, import and recovery", "Reports & Event Pack", "Advancement", "Audit timeline"]) requireCondition(builtText.includes(phrase), `Compiled Meet content is missing: ${phrase}`);
  requireCondition(!containsCredential(builtText), "Production output contains a credential-like secret.");
  requireCondition(!/\b(?:TODO|FIXME|implement later|starter app|lorem ipsum)\b/i.test(builtText), "Production output contains an incomplete or starter marker.");
  for (const { path, text } of textParts) {
    const remoteRuntime = /\b(?:import|from)\s*(?:\(|)\s*["']https?:\/\//i.test(text)
      || /\b(?:fetch|Worker|SharedWorker)\s*\(\s*["']https?:\/\/(?![^"']*\.supabase\.co)/i.test(text)
      || /\b(?:navigator\.)?sendBeacon\s*\(\s*["']https?:\/\//i.test(text)
      || /<(?:script|img|iframe)[^>]+src=["']https?:\/\//i.test(text)
      || /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\//i.test(text)
      || /@import\s+(?:url\()?\s*["']?https?:\/\//i.test(text)
      || /url\(\s*["']?https?:\/\//i.test(text);
    if (remoteRuntime) failures.push(`Compiled asset contains a remote runtime or tracker reference: ${path}.`);
    if (/\beval\s*\(|\b(?:new\s+)?Function\s*\(|\bdocument\.write\s*\(/.test(text)) failures.push(`Compiled asset contains an unsafe runtime API: ${path}.`);
    if (/<[a-z][^>]*\son(?:click|load|error|submit|change|input|keydown|keyup)\s*=/i.test(text)) failures.push(`Compiled asset contains an inline event handler: ${path}.`);
  }

  const repositoryMeetFiles = await safeFiles(meetRoot);
  for (const path of repositoryMeetFiles) {
    const rel = relative(meetRoot, path).replaceAll("\\", "/");
    if (!rel.startsWith("dist/") && (/(^|\/)\.env(?:\.|$)/i.test(rel) || /(^|\/)\.netlify\//i.test(rel) || /(^|\/)(?:tmp|temp)\//i.test(rel))) failures.push(`Committed environment or temporary artifact is forbidden: apps/meet/${rel}.`);
  }
  try {
    for (const entry of await readdir(repositoryRoot, { withFileTypes: true })) {
      if (entry.isFile() && /^\.env(?:\.|$)/i.test(entry.name)) failures.push(`Committed environment or temporary artifact is forbidden: ${entry.name}.`);
    }
  } catch (cause) {
    failures.push(`Repository root environment scan could not complete: ${cause instanceof Error ? cause.message : String(cause)}.`);
  }
  let releaseFiles;
  let gitAvailable = false;
  try {
    const result = await execute("git", ["-C", repositoryRoot, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
    releaseFiles = result.stdout.toString("utf8").split("\0").filter(Boolean).map((path) => join(repositoryRoot, path));
    gitAvailable = true;
  } catch {
    releaseFiles = [];
    failures.push("Git release inventory unavailable; repository and history secret verification cannot be trusted.");
  }
  const repositoryBinaryExtensions = new Set([".avif", ".bin", ".doc", ".docx", ".gif", ".ico", ".jpeg", ".jpg", ".mp3", ".mp4", ".pdf", ".png", ".ppt", ".pptx", ".webp", ".woff", ".woff2", ".xls", ".xlsx", ".zip"]);
  for (const path of releaseFiles) {
    const rel = relative(repositoryRoot, path).replaceAll("\\", "/");
    if (rel.startsWith(".git/") || rel.includes("/node_modules/") || rel.startsWith("apps/meet/dist/") || repositoryBinaryExtensions.has(extname(path).toLowerCase())) continue;
    try {
      const info = await stat(path);
      if (info.size <= 5 * 1024 * 1024 && containsCredential(await readFile(path, "utf8"))) failures.push(`Repository source contains a credential-like secret: ${rel}.`);
    }
    catch { /* A concurrently removed release artifact is handled by the diff/clean-worktree gate. */ }
  }
  if (gitAvailable) {
    try {
      const history = await execute("git", ["-C", repositoryRoot, "log", "-p", "--all", "--format="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      requireCondition(!containsCredential(history.stdout), "Git history contains a credential-like secret.");
    } catch (cause) {
      failures.push(`Git history secret scan could not complete: ${cause instanceof Error ? cause.message : String(cause)}.`);
    }
  }

  const netlifyRequirements = [
    [/\[build\][\s\S]*command\s*=\s*"pnpm build"/, "Netlify Meet build command is missing or incorrect for the apps/meet base directory."],
    [/\[build\][\s\S]*publish\s*=\s*"dist"/, "Netlify Meet publish directory is missing or incorrect for the apps/meet base directory."],
    [/\[\[redirects\]\][\s\S]*from\s*=\s*"\/\*"[\s\S]*to\s*=\s*"\/index\.html"[\s\S]*status\s*=\s*200/, "Netlify SPA fallback redirect is missing."],
    [/Content-Security-Policy\s*=\s*"[^"]*default-src 'self'[^"]*script-src 'self'[^"]*style-src 'self'[^"]*connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co[^"]*object-src 'none'[^"]*base-uri 'self'[^"]*frame-ancestors 'none'[^"]*form-action 'self'[^"]*"/, "Restrictive Content-Security-Policy with only Supabase external connections is missing."],
    [/Cross-Origin-Opener-Policy\s*=\s*"same-origin"/, "Cross-Origin-Opener-Policy header is missing."],
    [/Cross-Origin-Resource-Policy\s*=\s*"same-origin"/, "Cross-Origin-Resource-Policy header is missing."],
    [/Permissions-Policy\s*=\s*"[^"]*camera=\(\)[^"]*microphone=\(\)[^"]*"/, "Restrictive Permissions-Policy header is missing."],
    [/Referrer-Policy\s*=\s*"no-referrer"/, "Referrer-Policy header is missing."],
    [/X-Content-Type-Options\s*=\s*"nosniff"/, "X-Content-Type-Options header is missing."],
    [/X-Frame-Options\s*=\s*"DENY"/, "X-Frame-Options header is missing."],
    [/Strict-Transport-Security\s*=\s*"max-age=63072000; includeSubDomains; preload"/, "Strict-Transport-Security header is missing."],
    [/for\s*=\s*"\/assets\/\*"[\s\S]*Cache-Control\s*=\s*"public, max-age=31536000, immutable"/, "Immutable hashed-asset caching is missing."],
    [/for\s*=\s*"\/manifest\.webmanifest"[\s\S]*Cache-Control\s*=\s*"public, max-age=0, must-revalidate"/, "Manifest revalidation caching is missing."],
  ];
  for (const [pattern, message] of netlifyRequirements) requireCondition(pattern.test(netlify), message);
  const cspValue = netlify.match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1] ?? "";
  const connectSources = cspValue.match(/(?:^|;)\s*connect-src\s+([^;]+)/)?.[1]?.trim() ?? "";
  requireCondition(connectSources === "'self' https://*.supabase.co wss://*.supabase.co", "Content-Security-Policy connect-src must allow only Supabase external connections.");
  requireCondition(/site_url\s*=\s*"http:\/\/127\.0\.0\.1:4399"/.test(supabaseConfig) && /http:\/\/localhost:4399/.test(supabaseConfig), "Supabase local Auth redirects must use the Meet production-fixture port 4399.");

  const migrationRoot = join(repositoryRoot, "supabase", "migrations");
  const migrationFiles = await safeFiles(migrationRoot);
  const migrationText = (await Promise.all(migrationFiles.map((path) => readFile(path, "utf8")))).join("\n");
  requireCondition(/enable\s+row\s+level\s+security/i.test(migrationText), "Meet migrations are missing Row Level Security enablement.");
  requireCondition(/alter\s+publication\s+supabase_realtime\s+add\s+table/i.test(migrationText), "Meet migrations are missing Realtime publication registration.");
  if (migrationFiles.some((path) => path.endsWith("202608140001_meet_core.sql"))) {
    const migrationResult = await verifyMeetMigrations(migrationRoot);
    for (const issue of migrationResult.issues) failures.push(`Migration verifier: ${issue.code}: ${issue.target}: ${issue.message}`);
  }
  return { failures, distRoot, releaseVersion: RELEASE_VERSION };
}

async function runCli() {
  const result = await verifyMeetBuild();
  if (result.failures.length) {
    console.error(`Meet production verification failed (${result.failures.length}):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`Meet production verification passed: ${result.distRoot}`);
    console.log(`Verified release ${result.releaseVersion}, metadata, local assets, exact credit, safe runtime, Netlify security/caching, Auth redirects, RLS and Realtime publication.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCli();
