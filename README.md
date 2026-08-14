# Round Robin Race Control

An accessible three-lane round-robin race event suite with three editions:

- **Solo** — one self-contained `index.html` with no runtime dependencies.
- **Pro** — an installable React PWA with local event history, a visual Schedule Lab, live race command, spectator presentation, standings, insights, finals, exports, and recovery.
- **Meet** — a hosted, account-ready multi-bracket workbook with advancement, realtime collaboration, audit history, recovery, reports, and a zero-network read-only demo.

All editions use deterministic scheduling designed to minimise repeated opponents while balancing appearances and lanes. Solo and Pro keep event data on the current device; Meet adds an organisation-isolated Supabase backend for authorised officials.

## Play online

- [Solo — one self-contained HTML file](https://round-robin-race-control-solo.netlify.app/)
- [Pro — installable advanced PWA](https://round-robin-race-control-pro.netlify.app/)
- [Meet — hosted multi-bracket workbook](https://round-robin-race-control-meet.netlify.app/)

## Highlights

- Exact 9-, 12-, and 15-car presets plus deterministic custom schedules
- Lexicographic opponent-repeat optimisation with lower-bound certificates
- Three-lane race command, keyboard controls, corrections, reruns, undo, and audit history
- Competition, dense, and ordinal rankings with "Why this rank?" proofs
- Accessible charts, opponent matrix, lane balance, recent form, and finals analytics
- Tie-aware qualification, playoff/manual decisions, and guarded champion sealing
- Registration, payments, local autosave, JSON interchange, CSV Event Pack, replay, and recovery
- Dark/light/system themes, reduced-motion support, print layouts, and responsive 320px operation
- Offline PWA support in Pro; fully standalone offline HTML in Solo

## Run locally

### Solo

Open `single-file/index.html` directly, or serve the folder with any static server.

### Pro

```bash
pnpm install
pnpm --filter @rr3/pro build
pnpm --filter @rr3/pro test
pnpm test:pro:e2e
```

The production output is written to `apps/pro/dist`.

### Meet

```bash
pnpm install
pnpm --filter @rr3/meet test
pnpm --filter @rr3/meet build
node scripts/verify-meet-build.mjs
pnpm test:meet:e2e
```

The deterministic default E2E gate builds and verifies Meet, starts an owned localhost-only production server on `127.0.0.1:4399`, and runs the zero-network demo in Chromium. Live Supabase and deployed Netlify suites are explicit opt-ins through `RR3_MEET_LIVE_E2E=1` and `RR3_MEET_DEPLOYED_E2E=1`.

Meet's Netlify project uses `apps/meet` as its base, runs `pnpm build`, and publishes `dist`. Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are browser-visible environment settings; privileged keys must never be configured for the frontend.

## Verification

```bash
pnpm check
node scripts/verify-single-file.mjs
node scripts/verify-pro-build.mjs
node --test scripts/verify-pro-build.test.mjs
node --test scripts/verify-meet-build.test.mjs scripts/serve-meet-build.test.mjs
node scripts/verify-meet-migrations.mjs
```

## Privacy and operation

Solo and Pro have no account, backend, telemetry, or cross-device sync. Meet's official workspace uses Supabase Auth, organisation-isolated Postgres/RLS and Realtime; its local demo constructs no Supabase client and sends no production traffic. No edition includes advertising trackers. Use validated JSON backups and Event Packs for portable recovery and reporting.

## Credits

Made by Cesar Lacsamana and Ahsan Ali.
