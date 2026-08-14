import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { verifyProBuild } from "./verify-pro-build.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(extra = "") {
  const root = await mkdtemp(join(tmpdir(), "rr3-pro-verifier-"));
  roots.push(root);
  const pro = join(root, "apps", "pro");
  const dist = join(pro, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await mkdir(join(dist, "icons"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(pro, "package.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(dist, "index.html"), '<title>Round Robin Race Control Pro</title><meta property="og:title" content="Round Robin Race Control Pro"><meta property="og:description" content="Local"><link rel="manifest" href="/manifest.webmanifest">');
  await writeFile(join(dist, "manifest.webmanifest"), JSON.stringify({ name: "Round Robin Race Control Pro", short_name: "RR·3 Pro", display: "standalone", start_url: "/", scope: "/", icons: [{ src: "/icons/rr3-192.svg" }, { src: "/icons/rr3-512.svg" }] }));
  await writeFile(join(dist, "icons", "rr3-192.svg"), "<svg/>");
  await writeFile(join(dist, "icons", "rr3-512.svg"), "<svg/>");
  await writeFile(join(dist, "sw.js"), "self.addEventListener('fetch',()=>{});");
  await writeFile(join(dist, "workbox-fixture.js"), "workbox");
  await writeFile(join(dist, "assets", "index-fixture.css"), "body{}");
  await writeFile(join(dist, "assets", "index-fixture.js"), `Made by Cesar Lacsamana and Ahsan Ali 0.1.0 /registration /schedule /race /standings /finals /reports /settings /diagnostics /present same browser and device not cloud or cross-device ${extra}`);
  await writeFile(join(pro, "netlify.toml"), `[[redirects]]\nfrom = "/*"\nto = "/index.html"\nstatus = 200\n[[headers]]\nfor = "/*"\n[headers.values]\nContent-Security-Policy = "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'"\nStrict-Transport-Security = "max-age=63072000; includeSubDomains; preload"\nReferrer-Policy = "no-referrer"\nX-Content-Type-Options = "nosniff"\nPermissions-Policy = "camera=(), microphone=()"\n[[headers]]\nfor = "/sw.js"\n[headers.values]\nCache-Control = "no-cache"`);
  return root;
}

describe("Pro production verifier prohibited output", () => {
  for (const [label, content] of [
    ["remote runtime", 'import "https://cdn.example/app.js"'],
    ["eval", "eval('bad')"],
    ["Function constructor", "Function('return 1')"],
    ["document.write", "document.write('bad')"],
    ["inline handler", '<button onclick="bad()">'],
  ]) {
    it(`rejects ${label} in any compiled asset`, async () => {
      const result = await verifyProBuild(await fixture(content));
      assert.match(result.failures.join("\n"), /remote runtime|unsafe runtime API|inline event handler/i);
    });
  }
});
