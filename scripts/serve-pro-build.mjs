import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proRoot = join(repositoryRoot, "apps", "pro");
const distRoot = join(proRoot, "dist");
const port = Number(process.env.RR3_PRO_PORT ?? "4174");
const netlify = await readFile(join(proRoot, "netlify.toml"), "utf8");
const csp = netlify.match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1];
if (!csp) throw new Error("Pro Netlify Content-Security-Policy is unavailable");

const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"], [".json", "application/json"],
]);

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
    if (requestUrl.pathname === "/__rr3-e2e-update-sw.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Service-Worker-Allowed": "/" });
      response.end(`self.addEventListener("install", event => event.waitUntil(Promise.resolve()));`);
      return;
    }
    const relativePath = normalize(decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, ""));
    let file = resolve(distRoot, relativePath || "index.html");
    if (!file.startsWith(resolve(distRoot))) throw new Error("Invalid production asset path");
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); }
    catch { file = join(distRoot, "index.html"); }
    const headers = {
      "Content-Type": mime.get(extname(file)) ?? "application/octet-stream",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": file.endsWith("sw.js") ? "no-cache" : "no-store",
    };
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  } catch (cause) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(cause instanceof Error ? cause.message : "Production fixture server failed");
  }
}).listen(port, "127.0.0.1", () => console.log(`Pro production build at http://127.0.0.1:${port}`));
