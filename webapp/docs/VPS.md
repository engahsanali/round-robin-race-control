# Self-hosting on the Hostinger VPS

**Target URL:** https://ahsantechlabs.com/roundrobin/

**Status:** staged on 22 November 2026 (not live yet).

The Netlify build is unchanged. A VPS build sets `VITE_BASE=/roundrobin/` and runs the same function code in a small Node server.

## How it fits together

```text
Browser ── https://ahsantechlabs.com ── Traefik (coolify-proxy)
                                         │
                          ahsantechlabs-site-web-1 (nginx)
                          ├── /roundrobin/*         → round-robin-app:8787
                          └── /.netlify/identity/*  → round-robin-app:8787 → Netlify Identity
                                         │
                round-robin-race-manager-app-1 (node:24-alpine, read-only)
                ├── static Vite build under /roundrobin/
                ├── netlify/functions/events.ts and account.ts, unchanged handlers
                └── /data (bind mount /opt/round-robin-race-manager/data)
```

- `server/index.ts` maps Netlify function routes and context (`params`, `ip`, `cookies`, `site.url`) onto plain Node HTTP.
- `server/blobs.ts` replaces `@netlify/blobs` with a file store. ETags are content hashes. `onlyIfNew` and `onlyIfMatch` writes are serialized per key, so the bracket conflict rules still hold.
- `server/identity.ts` replaces the server half of `@netlify/identity`. Accounts, passwords and email verification stay in the existing Netlify Identity instance for `round-robin-race-manager.netlify.app`.
- The browser Identity client calls `/.netlify/identity` on the same origin. The Node server proxies that path to Netlify Identity.

## Build and deploy

```powershell
cd webapp
$env:VITE_BASE='/roundrobin/'; pnpm build; Remove-Item Env:VITE_BASE
pnpm build:server              # writes dist-server/server.mjs
```

Copy `dist/`, `dist-server/`, `Dockerfile` and `.dockerignore` to `/opt/round-robin-race-manager/build/<commit>/` on the VPS. Then:

```bash
cd /opt/round-robin-race-manager/build/<commit> && docker build -t rr-race-manager:<commit> .
cd /opt/round-robin-race-manager && RR_IMAGE_TAG=<commit> docker compose up -d
```

`/opt/round-robin-race-manager/.env` holds `RR_IMAGE_TAG`. Data must be owned by uid 1000 (`node`).

## Local self-hosted E2E

```powershell
node scripts/mock-identity.mjs cert.pem key.pem 9443   # self-signed cert, test only
$env:RR_IDENTITY_SITE_URL='https://127.0.0.1:9443'; $env:NODE_TLS_REJECT_UNAUTHORIZED='0'
$env:RR_DATA_DIR="$env:TEMP\rr-data"; $env:RR_STATIC_DIR="$PWD\dist"; $env:PORT='8788'
node dist-server/server.mjs
$env:BASE_URL='http://localhost:8788/roundrobin'; node scripts/e2e.mjs
```

Run the concurrency test through a link with real latency, or two tabs in the same browser may sync before the second save is sent.

## Known limits while Identity stays on Netlify

- Sign-up confirmation and password-reset emails link to `round-robin-race-manager.netlify.app`, which is the Identity site URL.
- Google sign-in returns to the Netlify site after consent.
- The site depends on Netlify Identity staying available.
