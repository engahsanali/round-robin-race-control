# Task 2 review fix 1 — Supabase hardening

## TDD evidence

- The review negative fixtures and pgTAP assertions were written first. The first runnable verifier result was RED: 15 passed and 14 failed because schema version 4 and the new review invariants did not exist.
- After migration `202608140004_meet_review_hardening.sql` and verifier implementation, `node --test scripts/verify-meet-migrations.test.mjs` passes all 29 tests, including 13 defect-specific negative fixtures.

## Implemented fixes

- Invitation failures now return indistinguishable structured results without aborting, so failed-attempt counters commit and eventually return `MEET_RATE_LIMITED` without membership or invitation mutation.
- Direct heat inserts are limited to schedule columns and protected result fields remain RPC-only. Direct registration, scheduling and rule mutations now bump parent versions and record actor/before/after audits in the same transaction.
- Required reasons reject NULL and blank values. Membership removal serializes the organisation and ordered owner set before enforcing the last-owner invariant.
- Advancement graph constraints enforce one organisation and meet end-to-end. Active lineage is globally unique per source bracket/car while replacement retires old destination cars, preserves historical references and marks descendants stale.
- Advancement validation derives total-wins rank groups and cutoff eligibility on the server without UUID competitive tie-breaking. Incomplete or unsupported automatic ranking requires a bounded manual reason. Destination allocation is derived from active occupancy and destination order across rules.
- RLS-readable operational tables are explicitly added to Supabase Realtime. A member-only, allow-listed, idempotent and rate-limited security-event RPC derives its actor and keeps direct inserts denied.
- Database constraints and command validation forbid non-null times for unassigned lanes.

## Verification

- `node --test scripts/verify-meet-migrations.test.mjs` — 29/29 passed.
- `node scripts/verify-meet-migrations.mjs` — passed: 15 RLS tables and 9 authenticated RPCs.
- `pnpm typecheck` — passed.
- `pnpm test -- --run` — 16 files and 205 tests passed.
- `git diff --check` — passed.
- Secret-pattern scan across all review-fix paths — no matches.
- pgTAP plan counts match their assertions: commands 40, RLS 32, review hardening 17, advancement review 9.

## Environment blocker

The earlier official local Supabase start attempt reached CLI 2.114.0 and failed with `LegacyDockerLifecycleInspectError` because neither Docker nor Podman is installed. PostgreSQL migrations and pgTAP therefore remain unexecuted locally; `supabase db reset` and `supabase test db` are mandatory on a supported container runtime before release.

## Commit

- `fix: harden Meet Supabase security model`
