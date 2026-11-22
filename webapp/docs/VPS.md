# Self-hosting on the Hostinger VPS

**Live URL:** https://ahsantechlabs.com/roundrobin/ (admin: https://ahsantechlabs.com/roundrobin/admin/)

**Status:** moved off Netlify on 22 November 2026. Accounts, sign-in and data all run on the VPS.

The Netlify copy (round-robin-race-manager.netlify.app) keeps running independently, with its own Netlify Identity accounts and Blobs data. The two copies do not sync.

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
- `src/identity-local.ts` replaces the browser half of `@netlify/identity` when `VITE_AUTH=local`. It shows the Google button when the server reports Google is configured.
- `server/google.ts` handles Google sign-in (see below). `/roundrobin/privacy` serves `server/privacy.html`.

## Google sign-in

- **OAuth client:** Google Cloud project `rosy-clover-515512-b8`, owned by ahsantechlabs@gmail.com. Web application client `799727978445-e6vq4d5fojs8sqv1d6sas7umv57l3i4g.apps.googleusercontent.com`, published In production.
  - Origin: `https://ahsantechlabs.com`
  - Redirect URI: `https://ahsantechlabs.com/roundrobin/api/auth/google/callback`
  - Scopes: `openid email profile`
  - Privacy policy: https://ahsantechlabs.com/roundrobin/privacy
- **Secret storage:** `RR_GOOGLE_CLIENT_ID` and `RR_GOOGLE_CLIENT_SECRET` live in `/opt/round-robin-race-manager/secrets/google.env` (root, 600), loaded with `env_file`. `RR_GOOGLE_REDIRECT_URI` is set in compose. Without the two variables the button stays hidden, and `/api/auth/google/*` returns `#google_error=unavailable`.
- **Flow:** `GET /api/auth/google/start` creates the state, nonce and PKCE verifier, and stores them server-side for 10 minutes, keyed by a hash of the state. It sets the `rr_google` state cookie (httpOnly, Secure, Lax, Path=/roundrobin/api/auth/google) and redirects to Google. `GET /api/auth/google/callback` then:
  - requires the state to match the cookie and the stored record, and uses it once;
  - exchanges the code with the PKCE verifier;
  - verifies the id_token: RS256 signature against Google's published keys, issuer, audience equal to the client ID, expiry, nonce, and email_verified.
- **Accounts:**
  - A first Google sign-in creates a verified user with sign-up method `google`.
  - The same verified email as an existing account links to it.
  - If that existing account was never verified, its password is cleared and its sessions are revoked. That stops someone who registered the address without owning it from keeping access.
  - Disabled accounts are refused.
- **Errors** come back as `/roundrobin/#google_error=state|cancelled|failed|disabled|busy|unavailable`, and the sign-in screen explains them.
- **Rotate the secret:** create a new secret in Google Cloud, update google.env, run `docker compose up -d`, then delete the old secret in Google Cloud.

## Email

No outgoing email yet. Resend is planned. contact@ahsantechlabs.com is a Hostinger mailbox, so Resend DNS must use only the `send` subdomain and `resend._domainkey`, and never change the root MX or SPF. Until then:

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
  node /s/make-admin.mjs contact@ahsantechlabs.com /cfg/admin.json /out/round-robin-admin.json
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
