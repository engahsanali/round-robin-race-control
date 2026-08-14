# Task 3 report — Meet accounts and hosted data layer

Date: 2026-08-14
Scope: `apps/meet`, workspace lockfile, this report

## Delivered

- Added a React 19/Vite/TypeScript single-route Meet application shell at `apps/meet` with a separate secure Netlify configuration and the exact creator credit.
- Added strict browser environment validation for only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; legacy anon, service-role, secret and database credentials are rejected and no configuration values are logged.
- Added Supabase Auth PKCE with automatic URL detection disabled, root-only callback exchange, synchronous history scrubbing before exchange, explicit signup/verification/signin/signout/recovery/password-update states, and listener cleanup.
- Added narrow typed `AuthPort` and `DataPort` boundaries. Tests use typed fakes; no service-role or privileged test bypass exists.
- Added RLS-shaped organisation/member/meet reads and deterministic normalized Meet hydration. Hydration validates organisation/meet/bracket ownership, converts database seconds to integer milliseconds, separates preliminary/final heats, keeps only current advancement snapshots, constructs lineage and validates `MeetStateV1` before publication.
- Added explicit wrappers for committed organisation, invitation, membership, security-event, winner/correction and advancement RPCs. Receipts distinguish permission, validation, conflict, offline/network and unknown failures; a committed mutation followed by failed readback remains success with a do-not-retry advisory.
- Added coalesced invalidation-only Realtime refresh with generation checks, abortable reads, connection state, channel cleanup, validated publication and dirty-form update notices.
- Added a pure/testable store with official/demo workspaces, role capabilities, save/connection state, duplicate pending command protection and conflict-safe state preservation.
- Added organisation create/join onboarding, role-truthful team directory, local member search, one-display invitation codes, revoke action and reasoned removal confirmation. The database remains authoritative for last-owner and permission errors.
- Added a compiled, validated, explicitly read-only demo. Entering demo creates no Supabase client interaction and makes no Auth, query, RPC or Realtime call.
- Added responsive account/team shell styling, 44px controls, visible focus, reduced-motion behavior, contained layout and security headers. Full workbook sheets remain Task 4 scope.

## TDD evidence

Initial focused RED:

- `pnpm --filter @rr3/meet test`
- 5/5 test files failed, zero tests collected.
- Each failure was the exact intended missing production import: `AuthBoundary`, `meetRepository`, `MeetStore`, `TeamDrawer`, or `MeetApp`.

Multi-meet isolation regression RED:

- `pnpm --filter @rr3/meet exec vitest run src/data/meetRepository.test.ts`
- 1/7 failed because participant/car/heat reads had no selected `bracket_id` filter.
- The implementation was changed to a staged meet/bracket read followed by bracket-ID-scoped owned-table reads.

Meet list/authoritative RPC contract RED:

- `pnpm --filter @rr3/meet exec vitest run src/data/meetRepository.test.ts`
- 1/8 failed with `repository.listMeets is not a function` before the typed list and explicit RPC wrappers were added.

Final focused GREEN:

- `pnpm --filter @rr3/meet test`
- 5 files, 20 tests passed.

## Verification

- `pnpm --filter @rr3/meet build` — pass; TypeScript and Vite production build, no source maps and no chunk-size warning.
- Final Meet output: app 105.26 kB, React vendor 192.35 kB, Supabase vendor 216.82 kB before gzip.
- `pnpm check` — pass; root typecheck plus 16 package test files / 205 tests.
- Unchanged Pro first parallel run: 72/74 passed with two 15-second timeouts and no assertion failure.
- Unchanged Pro serial confirmation: `vitest run --environment jsdom --testTimeout=30000 --maxWorkers=1` — 9 files / 74 tests passed.
- `pnpm --filter @rr3/pro build` — pass, including PWA output.
- Scoped source scan found no publishable secret values, service-role JWTs, database credential URLs, access tokens, token logging, dangerous HTML or password persistence.
- Solo and Pro source/deployment paths were not edited.

## Remaining release gate

No claim is made that Supabase migrations, Auth email flows, RLS, Realtime or two-user organisation isolation ran against a real hosted project in this task. Docker is unavailable and production Supabase authentication is not yet present. Those remain explicit Task 8 release gates; this task provides the browser-safe implementation and test boundaries only.
