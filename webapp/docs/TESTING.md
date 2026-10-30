# Testing and release evidence

## Required release checks

| Check | Purpose | Command |
|---|---|---|
| Unit tests | Schedule, fees, revisions, merge rules | `pnpm test` |
| Production build | TypeScript and bundling | `pnpm build` |
| Standard E2E | Full race workflow, desktop/mobile, duplicate owners | `node scripts/e2e.mjs` with `BASE_URL` |
| Concurrency E2E | Two-bracket operation, atomic conflict, auth | `pnpm test:concurrency` with `BASE_URL` |

Generated JSON evidence is written under `artifacts/` and is intentionally not versioned. Release screenshots are kept under `docs/screenshots/` and are versioned with the changelog.

## v1.1.0 production acceptance — 11 September 2026

Target: <https://round-robin-race-manager.netlify.app>

Production deploy: `6aa37ded9b7335b5874031de`

### Automated results

- Unit tests: **PASS**, 14 tests (10 domain and 4 synchronization tests).
- Build: **PASS**.
- Standard production E2E: **PASS**.
  - Durable deployed storage confirmed.
  - Desktop viewport: 1440 × 1000.
  - Mobile viewport: 390 × 844.
  - Four cars with a shared owner retained.
  - Three owner fee rows produced; four shared-owner entries aggregated correctly.
  - Eight main heats and six four-car rerace heats produced.
  - All six rerace pairs were unique.
  - Browser console errors: 0.
- Production concurrency E2E: **PASS**.
  - Two tabs entered six cars in Bracket A and six in Bracket B at the same time.
  - Both bracket saves survived with revision 2.
  - Both tabs recorded a winner simultaneously; one result remained in each bracket.
  - Same-bracket UI collision returned one 200 and one 409.
  - Direct atomic same-bracket collision returned one 200 and one 409.
  - The conflict banner was resolved using **Use saved bracket**.
  - An update without the owner key returned 401.
  - Browser console errors: 0.

### Visual evidence

- [`v1.1.0-bracket-a.png`](screenshots/v1.1.0-bracket-a.png) — Bracket A independently saved with six cars.
- [`v1.1.0-bracket-b.png`](screenshots/v1.1.0-bracket-b.png) — Bracket B independently saved with six cars.
- [`v1.1.0-simultaneous-results.png`](screenshots/v1.1.0-simultaneous-results.png) — a saved result after simultaneous operation.
- [`v1.1.0-conflict-protection.png`](screenshots/v1.1.0-conflict-protection.png) — same-bracket collision surfaced as a scoped decision.

The screenshots were captured from the permanent production URL and visually checked for saved status, roster retention, result display, conflict clarity, and layout integrity.

## Concurrency scenarios that must not regress

1. Bracket A and Bracket B edit and save at the same time: both return success and both changes survive.
2. One bracket saves while event payments change: both changes survive.
3. Two tabs save the same bracket from the same revision: one succeeds and one receives 409.
4. Resolving one bracket conflict does not modify another bracket.
5. An empty or unused Bracket B does not block Bracket A.
6. A delayed Bracket B start does not reset a completed Bracket A.
