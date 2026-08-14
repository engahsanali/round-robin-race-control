import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import { verifyMeetBuild } from "./verify-meet-build.mjs";

const roots = [];
const execute = promisify(execFile);
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const netlifyBuild = `[build]\ncommand = "pnpm build"\npublish = "dist"\n\n`;
const headers = `[[redirects]]\nfrom = "/*"\nto = "/index.html"\nstatus = 200\n\n[[headers]]\nfor = "/*"\n[headers.values]\nContent-Security-Policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"\nCross-Origin-Opener-Policy = "same-origin"\nCross-Origin-Resource-Policy = "same-origin"\nPermissions-Policy = "camera=(), geolocation=(), microphone=(), payment=(), usb=()"\nReferrer-Policy = "no-referrer"\nX-Content-Type-Options = "nosniff"\nX-Frame-Options = "DENY"\nStrict-Transport-Security = "max-age=63072000; includeSubDomains; preload"\n\n[[headers]]\nfor = "/assets/*"\n[headers.values]\nCache-Control = "public, max-age=31536000, immutable"\n\n[[headers]]\nfor = "/manifest.webmanifest"\n[headers.values]\nCache-Control = "public, max-age=0, must-revalidate"`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rr3-meet-verifier-"));
  roots.push(root);
  const meet = join(root, "apps", "meet");
  const dist = join(meet, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await mkdir(join(dist, "icons"), { recursive: true });
  await mkdir(join(root, "supabase", "migrations"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(meet, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(meet, "netlify.toml"), netlifyBuild + headers);
  await writeFile(join(dist, "index.html"), `<!doctype html><html><head><title>Round Robin Race Control Meet Edition</title><meta name="description" content="Hosted multi-bracket race meeting control"><link rel="canonical" href="https://round-robin-race-control-meet.netlify.app/"><meta property="og:title" content="Round Robin Race Control Meet Edition"><meta property="og:description" content="Run an entire race meeting"><meta property="og:image" content="https://round-robin-race-control-meet.netlify.app/social-card.svg"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/meet-192.svg"></head><body></body></html>`);
  await writeFile(join(dist, "manifest.webmanifest"), JSON.stringify({ name: "Round Robin Race Control Meet Edition", short_name: "RR·3 Meet", id: "/", start_url: "/", scope: "/", display: "standalone", icons: [{ src: "/icons/meet-192.svg", sizes: "192x192", type: "image/svg+xml" }, { src: "/icons/meet-512.svg", sizes: "512x512", type: "image/svg+xml" }] }));
  await writeFile(join(dist, "icons", "meet-192.svg"), "<svg/>");
  await writeFile(join(dist, "icons", "meet-512.svg"), "<svg/>");
  await writeFile(join(dist, "social-card.svg"), "<svg/>");
  await writeFile(join(dist, "assets", "index-fixture.css"), "body{overflow-x:clip}");
  await writeFile(join(dist, "assets", "index-fixture.js"), "Made by Cesar Lacsamana and Ahsan Ali 0.1.0 Explore local read-only demo Open official workspace No advertising trackers. Backup, import and recovery Reports & Event Pack Advancement Audit timeline");
  await writeFile(join(root, "supabase", "config.toml"), `[auth]\nsite_url = "http://127.0.0.1:4399"\nadditional_redirect_urls = ["http://localhost:4399"]`);
  await writeFile(join(root, "supabase", "migrations", "001.sql"), "alter table public.meets enable row level security; alter publication supabase_realtime add table public.meets;");
  return { root, meet, dist };
}

describe("Meet production verifier", () => {
  it("accepts a complete local release fixture", async () => {
    const { root } = await fixture();
    assert.deepEqual((await verifyMeetBuild(root)).failures, []);
  });

  for (const [label, mutate, expected] of [
    ["missing local icon", async ({ dist }) => writeFile(join(dist, "manifest.webmanifest"), JSON.stringify({ name: "Round Robin Race Control Meet Edition", short_name: "RR·3 Meet", id: "/", start_url: "/", scope: "/", display: "standalone", icons: [{ src: "/icons/missing.svg" }] })), /icon/i],
    ["wrong title", async ({ dist }) => writeFile(join(dist, "index.html"), (await readFile(join(dist, "index.html"), "utf8")).replace("Round Robin Race Control Meet Edition</title>", "Wrong title</title>")), /title/i],
    ["missing description", async ({ dist }) => writeFile(join(dist, "index.html"), (await readFile(join(dist, "index.html"), "utf8")).replace(/<meta name="description"[^>]+>/, "")), /description/i],
    ["missing canonical", async ({ dist }) => writeFile(join(dist, "index.html"), (await readFile(join(dist, "index.html"), "utf8")).replace(/<link rel="canonical"[^>]+>/, "")), /canonical/i],
    ["missing Open Graph metadata", async ({ dist }) => writeFile(join(dist, "index.html"), (await readFile(join(dist, "index.html"), "utf8")).replace(/<meta property="og:description"[^>]+>/, "")), /Open Graph description/i],
    ["wrong release version", async ({ meet }) => writeFile(join(meet, "package.json"), JSON.stringify({ version: "9.9.9" })), /release version/i],
    ["missing creator credit", async ({ dist }) => writeFile(join(dist, "assets", "index-fixture.js"), "0.1.0 Explore local read-only demo Open official workspace No advertising trackers. Backup, import and recovery Reports & Event Pack Advancement Audit timeline"), /credit/i],
    ["source map", async ({ dist }) => writeFile(join(dist, "assets", "index.js.map"), "{}"), /source map/i],
    ["remote tracker", async ({ dist }) => writeFile(join(dist, "assets", "tracker.js"), `fetch("https://tracker.example/collect")`), /remote runtime|tracker/i],
    ["beacon tracker", async ({ dist }) => writeFile(join(dist, "assets", "beacon.js"), `navigator.sendBeacon("https://tracker.example/collect", "x")`), /remote runtime|tracker/i],
    ["unsafe API", async ({ dist }) => writeFile(join(dist, "assets", "unsafe.js"), "document.write('bad')"), /unsafe runtime/i],
    ["inline handler", async ({ dist }) => writeFile(join(dist, "unsafe.html"), `<button onclick="bad()">bad</button>`), /inline event/i],
    ["credential", async ({ dist }) => writeFile(join(dist, "assets", "leak.js"), `ghp_${"1".repeat(36)}`), /secret|credential/i],
    ["credential in repository migration", async ({ root }) => writeFile(join(root, "supabase", "migrations", "leak.sql"), `select 'ghp_${"2".repeat(36)}';`), /repository.*secret|credential/i],
    ["committed environment", async ({ meet }) => writeFile(join(meet, ".env.production"), "VITE_SECRET=x"), /environment|\.env/i],
    ["missing security headers", async ({ meet }) => writeFile(join(meet, "netlify.toml"), `[[redirects]]\nfrom="/*"\nto="/index.html"\nstatus=200`), /content-security-policy|header/i],
    ["missing resource isolation", async ({ meet }) => writeFile(join(meet, "netlify.toml"), (netlifyBuild + headers).replace('Cross-Origin-Resource-Policy = "same-origin"', "")), /Cross-Origin-Resource-Policy/i],
    ["non-Supabase connection source", async ({ meet }) => writeFile(join(meet, "netlify.toml"), (netlifyBuild + headers).replace("wss://*.supabase.co;", "wss://*.supabase.co https://tracker.example;")), /only Supabase/i],
    ["wrong Netlify build contract", async ({ meet }) => writeFile(join(meet, "netlify.toml"), netlifyBuild.replace("pnpm build", "vite build") + headers), /build command/i],
    ["missing RLS", async ({ root }) => writeFile(join(root, "supabase", "migrations", "001.sql"), "alter publication supabase_realtime add table public.meets;"), /row level security|RLS/i],
    ["missing realtime publication", async ({ root }) => writeFile(join(root, "supabase", "migrations", "001.sql"), "alter table public.meets enable row level security;"), /realtime|publication/i],
  ]) {
    it(`rejects ${label}`, async () => {
      const paths = await fixture();
      await mutate(paths);
      assert.match((await verifyMeetBuild(paths.root)).failures.join("\n"), expected);
    });
  }

  it("rejects a credential removed from the worktree but retained in Git history", async () => {
    const paths = await fixture();
    await execute("git", ["init"], { cwd: paths.root });
    await execute("git", ["config", "user.email", "release-test@example.invalid"], { cwd: paths.root });
    await execute("git", ["config", "user.name", "Release verifier"], { cwd: paths.root });
    await writeFile(join(paths.root, "history-secret.txt"), `ghp_${"3".repeat(36)}`);
    await execute("git", ["add", "."], { cwd: paths.root });
    await execute("git", ["commit", "-m", "fixture secret"], { cwd: paths.root });
    await rm(join(paths.root, "history-secret.txt"));
    await execute("git", ["add", "-u"], { cwd: paths.root });
    await execute("git", ["commit", "-m", "remove fixture secret"], { cwd: paths.root });

    assert.match((await verifyMeetBuild(paths.root)).failures.join("\n"), /history.*secret|credential/i);
  });
});
