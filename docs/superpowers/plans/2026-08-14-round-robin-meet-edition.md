# Round Robin Race Control Meet Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, publish and deploy a Supabase-backed single-page Meet Edition for multi-bracket race meetings while preserving Solo and Pro unchanged.

**Architecture:** A new React/Vite application in `apps/meet` consumes a new pure `@rr3/meet-domain` package and the existing scheduler/ranking packages. Supabase Auth, Postgres, RLS, RPC transactions and Realtime provide hosted accounts and organisation-isolated collaboration; Netlify serves the SPA from a third independent project.

**Tech Stack:** React 19, TypeScript, Vite, Zod, Supabase JS/Auth/Postgres/Realtime, PostgreSQL/pgTAP, existing `@rr3/domain` and `@rr3/scheduler`, Vitest, Testing Library, Playwright, Netlify.

## Global Constraints

- Start from `origin/main` commit `3c99ee58cab7b9b0dfba6f2d388ed40212dcfdf1` in `.worktrees/meet-edition`.
- Do not modify Solo or Pro runtime/deployment files except root workspace/test configuration required to add Meet.
- Normal Meet operation uses one route and one main workbook workspace.
- Support at least 15 brackets and repeated car numbers across different brackets.
- Every organisation-owned table has enabled and tested RLS.
- Important winner and advancement writes use server-side transactions and optimistic versions.
- Never commit secrets, `.env` files, database passwords, tokens or service-role credentials.
- No advertising trackers or third-party product analytics.
- Creator credit remains exactly `Made by Cesar Lacsamana and Ahsan Ali`.

---

### Task 1: Meet domain, graph and advancement engine

**Files:**
- Create: `packages/meet-domain/package.json`
- Create: `packages/meet-domain/src/types.ts`
- Create: `packages/meet-domain/src/schema.ts`
- Create: `packages/meet-domain/src/progression.ts`
- Create: `packages/meet-domain/src/commands.ts`
- Create: `packages/meet-domain/src/serialization.ts`
- Create: `packages/meet-domain/src/reporting.ts`
- Create: `packages/meet-domain/src/index.ts`
- Test: `packages/meet-domain/src/*.test.ts`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces `MeetStateV1`, `BracketState`, `AdvancementRule`, `AdvancementPreview`, `validateMeetState`, `previewAdvancement`, `confirmAdvancementPure`, `markDependentAdvancementStale`, `parseMeetJson`, `serializeMeet`, and safe Meet CSV builders.
- Consumes pure standings/scheduler APIs from `@rr3/domain` and `@rr3/scheduler`.

- [ ] Write failing schema/property tests proving 15 independent brackets, bracket-scoped car-number uniqueness, DAG validation, bounded inputs and exact JSON round-trip.
- [ ] Run `pnpm vitest run packages/meet-domain/src/schema.test.ts packages/meet-domain/src/serialization.test.ts` and verify missing-module/test failures.
- [ ] Implement strict Zod schemas and deterministic serialization with dangerous-key/depth/node limits matching the existing domain boundary.
- [ ] Write failing progression tests for three qualifiers to nine-car final, four qualifiers to two semifinals to six-car final, multiple destinations, tied cutoffs, capacity overflow, duplicate advancement, stale upstream corrections and manual reason requirements.
- [ ] Implement deterministic preview/confirmation with stable destination allocation, lineage and lexicographic standings from the existing domain package.
- [ ] Write failing reporting tests for meet/bracket summaries and CSV formula injection.
- [ ] Implement reporting projections and export manifest.
- [ ] Run `pnpm vitest run packages/meet-domain/src` and `pnpm typecheck`.
- [ ] Commit explicit Task 1 paths with `feat: add Meet progression domain`.

### Task 2: Supabase schema, RLS, transactions and seed

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608140001_meet_core.sql`
- Create: `supabase/migrations/202608140002_meet_rls.sql`
- Create: `supabase/migrations/202608140003_meet_commands.sql`
- Create: `supabase/seed.sql`
- Create: `supabase/tests/meet_rls.test.sql`
- Create: `supabase/tests/meet_commands.test.sql`
- Create: `scripts/verify-meet-migrations.mjs`
- Test: `scripts/verify-meet-migrations.test.mjs`

**Interfaces:**
- Produces tables `organisations`, `organisation_memberships`, `organisation_invitations`, `meets`, `brackets`, `participants`, `cars`, `heats`, `advancement_rules`, `advancement_snapshots`, `audit_events`, `security_events`, and RPCs `confirm_heat_winner`, `confirm_advancement`, `replace_advancement`, `create_invitation`, `redeem_invitation`.
- RPCs accept authenticated actor plus expected versions and return changed entity/version/audit summaries.

- [ ] Write migration verifier tests requiring RLS on every owned table, fixed `search_path` for definer functions, unique lineage constraints, version checks and revoked unsafe grants.
- [ ] Run `node --test scripts/verify-meet-migrations.test.mjs` and verify RED.
- [ ] Implement core tables, constraints, indexes, updated timestamps and deterministic demo seed.
- [ ] Implement helper permission functions and role-specific RLS for owner/admin/organiser/marshal/viewer; anonymous and outsider receive no rows.
- [ ] Implement transactional winner, correction, advancement and invitation RPCs with advisory/row locks, version conflicts, reason checks, stale propagation and same-transaction audit insertion.
- [ ] Add pgTAP tests impersonating two organisations, five roles and anonymous access; test read/write matrices, duplicate prevention and optimistic conflicts.
- [ ] Run static verifier; when Supabase local runtime is available, run `supabase db reset` and `supabase test db`.
- [ ] Commit explicit Task 2 paths with `feat: add Meet Supabase security model`.

### Task 3: Meet application shell, authentication and typed data layer

**Files:**
- Create: `apps/meet/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `netlify.toml`
- Create: `apps/meet/src/main.tsx`
- Create: `apps/meet/src/app/MeetApp.tsx`
- Create: `apps/meet/src/app/AuthBoundary.tsx`
- Create: `apps/meet/src/app/MeetProviders.tsx`
- Create: `apps/meet/src/data/supabase.ts`
- Create: `apps/meet/src/data/meetRepository.ts`
- Create: `apps/meet/src/state/MeetStore.tsx`
- Create: `apps/meet/src/features/auth/AuthPanel.tsx`
- Create: `apps/meet/src/features/team/TeamDrawer.tsx`
- Test: `apps/meet/src/**/*.test.tsx`

**Interfaces:**
- Produces `useMeetSession`, `useOrganisation`, `useMeetStore`, `MeetRepository`, command receipts and explicit connection/save states.
- Reads only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; demo repository remains in-memory.

- [ ] Add failing tests for signup, email verification state, login, logout, recovery, safe callback handling, organisation creation/join and role-rendered controls.
- [ ] Add failing repository tests for authorised load/save, outsider rejection, optimistic conflicts, realtime update merge and offline/error states using a typed fake Supabase boundary.
- [ ] Implement the minimal auth boundary and root-only callback handling without tokens in logs.
- [ ] Implement typed repository/RPC adapters and realtime subscriptions with abort/unsubscribe cleanup.
- [ ] Implement organisation membership/invitation UI with owner-only controls and a separate in-memory read-only demo.
- [ ] Run `pnpm --filter @rr3/meet test` and `pnpm --filter @rr3/meet build`.
- [ ] Commit explicit Task 3 paths with `feat: add Meet accounts and hosted data layer`.

### Task 4: Single-page workbook, setup and bracket race sheets

**Files:**
- Create: `apps/meet/src/features/workbook/MeetWorkbook.tsx`
- Create: `apps/meet/src/features/workbook/MeetToolbar.tsx`
- Create: `apps/meet/src/features/workbook/BracketIndex.tsx`
- Create: `apps/meet/src/features/workbook/ProgressionMap.tsx`
- Create: `apps/meet/src/features/setup/MeetSetupDrawer.tsx`
- Create: `apps/meet/src/features/registration/RegistrationDrawer.tsx`
- Create: `apps/meet/src/features/brackets/BracketSheet.tsx`
- Create: `apps/meet/src/features/brackets/BracketRaceControl.tsx`
- Create: `apps/meet/src/features/brackets/BracketStandings.tsx`
- Create: `apps/meet/src/styles/tokens.css`, `workbook.css`, `print.css`
- Test: matching `*.test.tsx`

**Interfaces:**
- Bracket sheets consume bracket-scoped event projections and emit repository commands only through `MeetStore`.
- Collapsed sheets render only summaries; active/expanded sheets render details.

- [ ] Write failing component tests for 15 collapsed sheets, lazy detail rendering, anchored navigation, frozen accessible tables, expand/collapse all, print all and no whole-page overflow contract.
- [ ] Write failing behaviour tests for bracket setup, repeated numbers in different brackets, registration, schedule generation, winner entry, correction reason, current/next heat, progress, standings and bracket winner.
- [ ] Implement desktop workbook toolbar/index/progression/sheets with semantic tables and contained overflow.
- [ ] Implement keyboard lane selection/confirm/navigation and permission-aware large touch controls.
- [ ] Implement mobile bracket selector/cards/persistent race control and print expansion/summary.
- [ ] Run focused Meet component tests, axe-compatible semantic assertions and production build.
- [ ] Commit explicit Task 4 paths with `feat: build Meet workbook race control`.

### Task 5: Advancement, audit, admin tracking and realtime collaboration

**Files:**
- Create: `apps/meet/src/features/advancement/AdvancementPanel.tsx`
- Create: `apps/meet/src/features/advancement/AdvancementDialog.tsx`
- Create: `apps/meet/src/features/audit/AuditTimeline.tsx`
- Create: `apps/meet/src/features/admin/AdminDashboard.tsx`
- Create: `apps/meet/src/features/status/SaveStatus.tsx`
- Modify: `apps/meet/src/state/MeetStore.tsx`
- Test: matching `*.test.tsx`

**Interfaces:**
- Advancement uses `previewAdvancement` locally and server `confirm_advancement` for the authoritative commit.
- Audit and admin dashboards consume RLS-filtered realtime streams.

- [ ] Write failing UI tests for automatic previews, tied cutoff choices, multi-destination allocation, explicit confirmation, reason-required manual changes, duplicate protection and stale upstream warnings.
- [ ] Implement progression workflow with accessible guarded dialogs and source-version display.
- [ ] Write failing tests for actor/timestamp/before-after audit search, security events, active-meet facts and realtime concurrent result conflicts.
- [ ] Implement searchable audit/admin panels, realtime presence/save states and conflict recovery.
- [ ] Run all Meet unit/component tests and build.
- [ ] Commit explicit Task 5 paths with `feat: add Meet advancement and accountability`.

### Task 6: Meet backup, restore, reports and demo

**Files:**
- Create: `apps/meet/src/features/backup/BackupDrawer.tsx`
- Create: `apps/meet/src/features/reports/MeetReports.tsx`
- Create: `apps/meet/src/demo/demoMeet.ts`
- Create: `fixtures/demo-meet.json`
- Test: matching unit/component tests

**Interfaces:**
- Export uses `serializeMeet`; import validates fully and creates a new transactional meet.
- Demo implements the repository interface but has no production Supabase subscription or mutation.

- [ ] Write failing tests for complete meet JSON round-trip, failed-import preservation, cross-edition bracket import, report manifest, CSV injection and readable print content.
- [ ] Implement backup/restore preview and guarded create-new import.
- [ ] Implement registration/schedule/results/standings/advancement/audit CSVs plus printable all-bracket report and creator credit.
- [ ] Implement deterministic read-only demo and prove no production repository calls.
- [ ] Run Meet tests/build and secret/source verifier.
- [ ] Commit explicit Task 6 paths with `feat: add Meet recovery and reporting`.

### Task 7: End-to-end, responsive, security and release verification

**Files:**
- Create: `tests/e2e/meet-auth.spec.ts`
- Create: `tests/e2e/meet-workbook.spec.ts`
- Create: `tests/e2e/meet-progression.spec.ts`
- Create: `tests/e2e/meet-concurrency.spec.ts`
- Create: `tests/e2e/meet-responsive.spec.ts`
- Create: `scripts/serve-meet-build.mjs`
- Create: `scripts/verify-meet-build.mjs`
- Create: `scripts/verify-meet-build.test.mjs`
- Modify: `playwright.config.ts`, `package.json`, `README.md`

**Interfaces:**
- `pnpm test:meet:e2e` owns the Meet production build/server lifecycle and runs serial authenticated journeys.
- Production verifier scans build, configuration, migrations and repository for secrets/unsafe runtime patterns.

- [ ] Add build verifier negative fixtures for missing routes/assets/credit/headers, source maps, unsafe APIs, remote trackers, committed secrets and missing RLS.
- [ ] Add production-served auth/account and two-organisation isolation journeys.
- [ ] Add three-qualifier-to-final and four-qualifier-to-semifinal-to-final journeys including correction/stale/reconfirmation.
- [ ] Add two-context concurrent winner/version conflict and realtime follow journey.
- [ ] Add 320/mobile/tablet/desktop/projector, keyboard, dialog focus, reduced-motion, print and contained-overflow journeys.
- [ ] Run Meet unit/integration/RLS/E2E/build/verifier, then unchanged Solo verifier/shell and full Pro tests/build/E2E.
- [ ] Run intended-diff and repository-history secret scans.
- [ ] Commit explicit Task 7 paths with `test: verify Meet production release`.

### Task 8: Production Supabase, GitHub and Netlify release

**Files:**
- Modify only if required by verified deployment: `apps/meet/netlify.toml`, `README.md`

**Interfaces:**
- Production Supabase project receives migrations/seed, Auth redirect allow-list and Realtime publication.
- Netlify project builds `apps/meet` from GitHub `main` with public Supabase variables only.

- [ ] Authenticate the official Supabase CLI/plugin; create/link the production project without exposing credentials.
- [ ] Apply migrations, enable email Auth/verification and Realtime, then create two test users/two organisations and prove RLS isolation plus authorised collaboration.
- [ ] Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Meet Netlify project environment.
- [ ] Commit final verified changes, scan staged diff, push branch/main as authorised and verify GitHub commit parity.
- [ ] Create/link `round-robin-race-control-meet` to the same GitHub repository with continuous deployment from `main`; build from root and publish `apps/meet/dist`.
- [ ] Verify Meet live account/progression/concurrency flows and public HTTP 200 at mobile/tablet/desktop sizes.
- [ ] Read-only verify Solo and Pro still return HTTP 200 and were not reconfigured.
- [ ] Report final GitHub commit and all three public links.
