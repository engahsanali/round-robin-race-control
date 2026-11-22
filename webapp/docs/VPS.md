# Self-hosting on the Hostinger VPS

**Live URL:** https://ahsantechlabs.com/roundrobin/ (admin: https://ahsantechlabs.com/roundrobin/admin/)

**Status:** moved off Netlify on 22 November 2026. Accounts, sign-in and data all run on the VPS.

The Netlify build still works unchanged. The VPS build sets `VITE_BASE=/roundrobin/` and `VITE_AUTH=local`, and runs the same function code in a small Node server.

## How it fits together

```text
Browser ── https://ahsantechlabs.com ── Traefik (coolify-proxy)
                                         │
                          ahsantechlabs-site-web-1 (nginx)
                          └── /roundrobin/*  → round-robin-app:8787
                                         │
                round-robin-race-manager-app-1 (node:24-alpine, uid 1000, read-only)
                ├── static Vite build under /roundrobin/
                ├── netlify/functions/events.ts and account.ts, unchanged handlers
                ├── /roundrobin/admin/  owner-only dashboard (server/admin.ts)
                ├── /data     (bind mount /opt/round-robin-race-manager/data)
                └── /secrets/admin.json  (read-only, uid 1000, mode 0400)
```

- `server/index.ts` maps Netlify function routes and context (`params`, `ip`, `cookies`, `site.url`) onto plain Node HTTP.
- `server/blobs.ts` replaces `@netlify/blobs` with a file store. ETags are content hashes. `onlyIfNew` and `onlyIfMatch` writes are serialized per key, so the bracket conflict rules still hold.
- `server/auth.ts` and `server/identity.ts` replace Netlify Identity:
  - scrypt password hashes (N=2^15, r=8, p=1), stored in the `race-manager-auth` store under `/data`.
  - `rr_session` cookie: random token, httpOnly, Secure, SameSite=Lax, Path=/roundrobin, 30 days. Sessions are revoked by bumping the user's `sessionEpoch` (sign out everywhere, password change, disable).
  - Same-origin checks on every write, plus the existing per-IP and per-email rate limits.
  - One-time hashed tokens for email verification and password reset.
  - Each user maps to a workspace id. Users created from the dashboard can be linked to a workspace that existed before the move.
- `src/identity-local.ts` replaces the browser half of `@netlify/identity` when `VITE_AUTH=local`. Google sign-in is hidden.

## Email

No outgoing email. A free sender that can mail any address was not available (Cloudflare Email Sending to arbitrary recipients needs the paid Workers plan). So:

- New accounts can sign in at once. Verification is a flag the owner sets in the dashboard. `RR_REQUIRE_VERIFIED=1` would block unverified sign-ins.
- "Forgot password" logs a request that the dashboard flags. The owner creates a one-time reset link (24 hours) or a temporary password and sends it to the user.

## Admin dashboard

`/roundrobin/admin/` is not linked from the app. It needs the admin email, password and a TOTP code. The `rr_admin` cookie is httpOnly, Secure, SameSite=Strict, Path=/roundrobin/admin, for 8 hours. Sign-in is limited to 5 tries per IP and 30 in total per 15 minutes.

- It lists users with sign-up time and method, verified status, last login, login count, events, brackets, races run and recent activity. You can sort, filter and see a leaderboard.
- Actions: reset link, temporary password, force sign-out, verify, disable/enable, link an old workspace, delete login (race data is kept), add a user.
- Every action is written to the audit log (`admin/audit`).

Create or rotate the admin login on the VPS (prints no secrets):

```bash
cd /opt/round-robin-race-manager
docker run --rm -v "$PWD/build/<commit>/scripts:/s:ro" -v /root:/out -v "$PWD/secrets:/cfg" node:24-alpine \
  node /s/make-admin.mjs engahsanali@gmail.com /cfg/admin.json /out/round-robin-admin.json
chown 1000:1000 secrets/admin.json && chmod 400 secrets/admin.json && chmod 600 /root/round-robin-admin.json
docker compose up -d --force-recreate
```

`/root/round-robin-admin.json` (root only) holds the password and the `otpauth://` URI for an authenticator app.

## Build and deploy

```powershell
cd webapp
$env:VITE_BASE='/roundrobin/'; $env:VITE_AUTH='local'; npm run build; Remove-Item Env:VITE_BASE, Env:VITE_AUTH
npm run build:server              # writes dist-server/server.mjs
```

Copy `dist/`, `dist-server/`, `Dockerfile` and `.dockerignore` to `/opt/round-robin-race-manager/build/<commit>/` on the VPS. Then:

```bash
cd /opt/round-robin-race-manager/build/<commit> && docker build -t rr-race-manager:<commit> .
cd /opt/round-robin-race-manager && sed -i 's/^RR_IMAGE_TAG=.*/RR_IMAGE_TAG=<commit>/' .env && docker compose up -d
```

Data must be owned by uid 1000 (`node`).

## Tests

```powershell
npx vitest run                    # includes server/auth.test.ts (scrypt, sessions, reset tokens, RFC 6238 TOTP)
node scripts/make-admin.mjs you@example.test $env:TEMP\admin.json $env:TEMP\admin-login.json
$env:RR_DATA_DIR="$env:TEMP\rr-data"; $env:RR_STATIC_DIR="$PWD\dist"; $env:RR_BASE_PATH='/roundrobin'; $env:RR_ADMIN_FILE="$env:TEMP\admin.json"; $env:PORT='18791'
node dist-server/server.mjs
$env:BASE_URL='http://localhost:18791/roundrobin'; $env:RACE_E2E_EMAIL='e2e@example.test'; $env:RACE_E2E_PASSWORD='<15+ chars>'
node scripts/signup-e2e.mjs       # real sign-up, save, sign-out, forgot, sign-in
node scripts/e2e.mjs; node scripts/recovery-e2e.mjs
$env:ADMIN_CREDS="$env:TEMP\admin-login.json"; $env:TEST_EMAIL=$env:RACE_E2E_EMAIL; $env:TEST_PASSWORD=$env:RACE_E2E_PASSWORD
node scripts/admin-ui-e2e.mjs; node scripts/admin-e2e.mjs   # the last one deletes the test login
```

Run the concurrency test through a link with real latency, or two tabs in the same browser may sync before the second save is sent.
