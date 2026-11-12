# Testing and release evidence

## Required release checks

| Check | Purpose | Command |
|---|---|---|
| Unit tests | Schedule, fees, revisions, merge rules | `pnpm test` |
| Production build | TypeScript and bundling | `pnpm build` |
| Standard E2E | Full race workflow, desktop/mobile, duplicate owners | `node scripts/e2e.mjs` with `BASE_URL` |
| Concurrency E2E | Two-bracket operation, atomic conflict, auth | `pnpm test:concurrency` with `BASE_URL` |

Generated JSON evidence is written under `artifacts/` and is intentionally not versioned. Release screenshots are kept under `docs/screenshots/` and are versioned with the changelog.

## v1.1.1 production - 12 November 2026

- Unit tests: **PASS**, 14 tests.
- Production build and TypeScript: **PASS**.
- Standings browser regression: **PASS**, seven viewports in local Chrome on Windows. Run `npm run test:standings` with `BASE_URL` set to the candidate server. The test intercepts its event API and uses an isolated synthetic event, so no live race is modified.
- Standard local desktop/mobile E2E: **PASS**, including shared-owner fees, main scoring, and the four-car rerace, with zero browser errors. This local run does not verify deployed storage.
- Production standard and deployed concurrency E2E: **PASS** on the permanent URL, including durable storage, independent brackets, 200/409 conflict handling, 401 unauthorized writes, and zero browser errors.
- Production deployment: `6af54ff84554aa46f4382765`. Preview and production standings checks passed across all seven viewports; desktop and mobile screenshots inspected.

The standings regression covers 1440 x 1000, 1100 x 800, 1024 x 768, 390 x 844, 320 x 640, 844 x 390, and 320 x 300 viewports, plus scoring/clearing, all 21 competitors, keyboard expand/collapse, print output, and unauthenticated read-only public display. `CHROME_PATH` can select the browser executable explicitly. Desktop/mobile screenshots under `docs/screenshots/v1.1.1-standings-*.png` were visually inspected.

## v1.1.0 production acceptance - 11 September 2026

Target: <https://round-robin-race-manager.netlify.app>

Production deploy: `6aa37ded9b7335b5874031de`

### Automated results

- Unit tests: **PASS**, 14 tests (10 domain and 4 synchronization tests).
- Build: **PASS**.
- Standard production E2E: **PASS**.
  - Durable deployed storage confirmed.
  - Desktop viewport: 1440 x 1000.
  - Mobile viewport: 390 x 844.
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

- [`v1.1.0-bracket-a.png`](screenshots/v1.1.0-bracket-a.png) - Bracket A independently saved with six cars.
- [`v1.1.0-bracket-b.png`](screenshots/v1.1.0-bracket-b.png) - Bracket B independently saved with six cars.
- [`v1.1.0-simultaneous-results.png`](screenshots/v1.1.0-simultaneous-results.png) - a saved result after simultaneous operation.
- [`v1.1.0-conflict-protection.png`](screenshots/v1.1.0-conflict-protection.png) - same-bracket collision surfaced as a scoped decision.

The screenshots were captured from the permanent production URL and visually checked for saved status, roster retention, result display, conflict clarity, and layout integrity.

## Concurrency scenarios that must not regress

1. Bracket A and Bracket B edit and save at the same time: both return success and both changes survive.
2. One bracket saves while event payments change: both changes survive.
3. Two tabs save the same bracket from the same revision: one succeeds and one receives 409.
4. Resolving one bracket conflict does not modify another bracket.
5. An empty or unused Bracket B does not block Bracket A.
6. A delayed Bracket B start does not reset a completed Bracket A.

