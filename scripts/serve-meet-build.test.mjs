import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { startMeetBuildServer } from "./serve-meet-build.mjs";

const roots = [];
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rr3-meet-server-"));
  roots.push(root);
  const distRoot = join(root, "dist");
  await mkdir(join(distRoot, "assets"), { recursive: true });
  await writeFile(join(distRoot, "index.html"), "<!doctype html><title>Meet fixture</title>");
  await writeFile(join(distRoot, "assets", "app.js"), "export const ready = true;");
  await writeFile(join(distRoot, "manifest.webmanifest"), "{}");
  const netlifyPath = join(root, "netlify.toml");
  await writeFile(netlifyPath, `[[headers]]\nfor = "/*"\n[headers.values]\nContent-Security-Policy = "default-src 'self'; object-src 'none'"\nCross-Origin-Opener-Policy = "same-origin"\nReferrer-Policy = "no-referrer"\nX-Content-Type-Options = "nosniff"\nX-Frame-Options = "DENY"`);
  return { distRoot, netlifyPath };
}

describe("Meet production fixture server", () => {
  it("serves health, HEAD, correct MIME/cache and extensionless SPA routes", async () => {
    const config = await fixture();
    const server = await startMeetBuildServer({ ...config, port: 0 });
    servers.push(server);

    const health = await fetch(`${server.url}/__rr3_health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");
    assert.equal(health.headers.get("cache-control"), "no-store");

    const asset = await fetch(`${server.url}/assets/app.js`, { method: "HEAD" });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /text\/javascript/);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
    assert.equal(await asset.text(), "");

    const route = await fetch(`${server.url}/meet/demo`);
    assert.equal(route.status, 200);
    assert.match(await route.text(), /Meet fixture/);
    assert.equal(route.headers.get("content-security-policy"), "default-src 'self'; object-src 'none'");
  });

  it("returns 404 for missing assets and refuses encoded traversal", async () => {
    const config = await fixture();
    const server = await startMeetBuildServer({ ...config, port: 0 });
    servers.push(server);

    assert.equal((await fetch(`${server.url}/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${server.url}/..%2f..%2fpackage.json`)).status, 400);
  });

  it("fails deterministically with EADDRINUSE when the requested port is occupied", async () => {
    const config = await fixture();
    const first = await startMeetBuildServer({ ...config, port: 0 });
    servers.push(first);
    const port = Number(new URL(first.url).port);
    await assert.rejects(startMeetBuildServer({ ...config, port }), (error) => error?.code === "EADDRINUSE");
  });
});
