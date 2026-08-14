import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultMeetRoot = join(repositoryRoot, "apps", "meet");
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".svg", "image/svg+xml"],
  [".json", "application/json; charset=utf-8"], [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".ico", "image/x-icon"], [".woff", "font/woff"], [".woff2", "font/woff2"],
]);
const securityHeaderNames = ["Content-Security-Policy", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy", "Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options", "Strict-Transport-Security"];

function parseSecurityHeaders(netlify) {
  return Object.fromEntries(securityHeaderNames.flatMap((name) => {
    const value = netlify.match(new RegExp(`${name.replaceAll("-", "[-]")}\\s*=\\s*"([^"]+)"`))?.[1];
    return value ? [[name, value]] : [];
  }));
}

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function startMeetBuildServer({
  distRoot = join(defaultMeetRoot, "dist"),
  netlifyPath = join(defaultMeetRoot, "netlify.toml"),
  host = "127.0.0.1",
  port = Number(process.env.RR3_MEET_PORT ?? "4399"),
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError(`Invalid RR3_MEET_PORT: ${port}`);
  const root = resolve(distRoot);
  const netlify = await readFile(netlifyPath, "utf8");
  const securityHeaders = parseSecurityHeaders(netlify);
  if (!securityHeaders["Content-Security-Policy"]) throw new Error("Meet Netlify Content-Security-Policy is unavailable");

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (!['GET', 'HEAD'].includes(method)) {
      response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
      if (requestUrl.pathname === "/__rr3_health") {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...securityHeaders });
        response.end(method === "HEAD" ? undefined : "ok");
        return;
      }
      let decoded;
      try { decoded = decodeURIComponent(requestUrl.pathname); }
      catch { response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Malformed request path"); return; }
      if (decoded.includes("\\") || decoded.split("/").includes("..")) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Invalid production asset path"); return;
      }
      const relativePath = decoded.replace(/^\/+/, "");
      let file = resolve(root, relativePath || "index.html");
      if (!within(root, file)) { response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Invalid production asset path"); return; }
      let found = false;
      try {
        const info = await stat(file);
        if (info.isDirectory()) file = join(file, "index.html");
        found = (await stat(file)).isFile();
      } catch { found = false; }
      const extension = extname(relativePath);
      if (!found && !extension) { file = join(root, "index.html"); found = true; }
      if (!found) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...securityHeaders }); response.end("Not found"); return; }
      const data = method === "HEAD" ? null : await readFile(file);
      const cache = relativePath.startsWith("assets/") ? "public, max-age=31536000, immutable" : extname(file) === ".html" ? "no-store" : "public, max-age=0, must-revalidate";
      response.writeHead(200, { "Content-Type": mime.get(extname(file)) ?? "application/octet-stream", "Cache-Control": cache, ...securityHeaders });
      response.end(data ?? undefined);
    } catch (cause) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end(cause instanceof Error ? cause.message : "Meet production fixture server failed");
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => { server.off("listening", onListening); rejectListen(error); };
    const onListening = () => { server.off("error", onError); resolveListen(); };
    server.once("error", onError); server.once("listening", onListening); server.listen(port, host);
  });
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  let closed = false;
  return {
    server,
    url: `http://${host}:${activePort}`,
    close: () => new Promise((resolveClose, rejectClose) => {
      if (closed || !server.listening) { resolveClose(); return; }
      closed = true;
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function runCli() {
  const fixture = await startMeetBuildServer();
  console.log(`Meet production build at ${fixture.url}`);
  const shutdown = async (signal) => {
    try { await fixture.close(); process.exitCode = 0; }
    catch { process.exitCode = 1; }
    finally { process.removeAllListeners("SIGINT"); process.removeAllListeners("SIGTERM"); if (signal) process.kill(process.pid, signal); }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
