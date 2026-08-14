import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const meetRoot = join(repositoryRoot, "apps", "meet");
const distRoot = join(meetRoot, "dist");
const port = Number(process.env.RR3_MEET_PORT ?? "4399");
const netlify = await readFile(join(meetRoot, "netlify.toml"), "utf8");
const csp = netlify.match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1];
if (!csp) throw new Error("Meet Netlify Content-Security-Policy is unavailable");

const mime = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".svg", "image/svg+xml"], [".json", "application/json"]]);

createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
    const relativePath = normalize(decodeURIComponent(requestUrl.pathname).replace(/^[/\\]+/, ""));
    let file = resolve(distRoot, relativePath || "index.html");
    if (!file.startsWith(resolve(distRoot))) throw new Error("Invalid production asset path");
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); }
    catch { file = join(distRoot, "index.html"); }
    response.writeHead(200, {
      "Content-Type": mime.get(extname(file)) ?? "application/octet-stream",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(response);
  } catch (cause) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(cause instanceof Error ? cause.message : "Meet production fixture server failed");
  }
}).listen(port, "127.0.0.1", () => console.log(`Meet production build at http://127.0.0.1:${port}`));
