# Task 2 report — Supabase schema, RLS, transactions and seed

## RED evidence

- `node --test scripts/verify-meet-migrations.test.mjs` failed before production implementation with `ERR_MODULE_NOT_FOUND` for `scripts/verify-meet-migrations.mjs`.
- The first bare `node` invocation was an environment error because Node was absent from this PowerShell `PATH`. The test was rerun with the Codex runtime Node binary and produced the intended missing-verifier failure.
- pgTAP contracts were written before the matching migrations and RPCs. They contain 24 RLS/role/isolation assertions and 30 command assertions. The machine cannot execute them locally because it has neither Docker nor Podman.

## Implemented security model

- Versioned core, RLS and command migrations define all required Meet tables, normalized advancement destinations/selections, UUID identities, bounded constraints, organisation-constrained foreign keys, bracket-scoped car-number uniqueness, immutable advancement lineage, optimistic versions, timestamps and indexes.
- Every Meet-owned table enables and forces RLS. Policies expose no anonymous rows, isolate organisations and implement owner/admin/organiser/marshal/viewer boundaries. Important membership, invitation, heat-result, advancement and audit writes are RPC-only.
- Private membership, rate-limit and transaction helpers use an empty `search_path`; public RPCs derive the actor from `auth.uid()`. Execution is revoked from `public`/`anon` and granted only for the eight intentional authenticated RPCs.
- Winner/correction and advancement confirmation/replacement use row locks, expected versions, server-side status/role/input validation, same-transaction audit/idempotency, source lineage and transitive stale propagation.
- Invitation codes use 24 random bytes, persist only a SHA-256 digest, expire, are single-use and pass through first-party mutation rate limits.
- `supabase/seed.sql` is deterministic and contains an unusable `invalid.example` local identity with no usable password or production credential.

## GREEN evidence

- `node --test scripts/verify-meet-migrations.test.mjs` — 16/16 passed: the checked-in migration contract plus 15 negative mutation fixtures.
- `pnpm typecheck` — passed.
- `pnpm test` — 16 files and 205 tests passed.
- `git diff --check` — passed.
- Secret-pattern scan across Task 2 paths — no matches.

## Supabase local-runtime evidence

- Supabase CLI is pinned exactly at `2.114.0` in the root dev dependencies and lockfile.
- A bare `pnpm supabase start` first stopped because the package shim could not resolve Node from this shell's `PATH`.
- With the known Codex Node directory prepended for that process, `pnpm supabase start` reached the official CLI and failed with `LegacyDockerLifecycleInspectError`: Docker was not found and Podman was also not found.
- Consequently, `supabase db reset` and `supabase test db` were not runnable here. The pgTAP files are committed and runnable once a supported container runtime is available.

## Changed paths

- `package.json`
- `pnpm-lock.yaml`
- `supabase/config.toml`
- `supabase/migrations/202608140001_meet_core.sql`
- `supabase/migrations/202608140002_meet_rls.sql`
- `supabase/migrations/202608140003_meet_commands.sql`
- `supabase/seed.sql`
- `supabase/tests/meet_rls.test.sql`
- `supabase/tests/meet_commands.test.sql`
- `scripts/verify-meet-migrations.mjs`
- `scripts/verify-meet-migrations.test.mjs`
- `scripts/fixtures/meet-migrations-negative.json`
- `.superpowers/sdd/2026-08-14-round-robin-meet-edition/task-2-report.md`

## Commit

- `feat: add Meet Supabase security model`

## Release concern

- Static verification and repository regressions pass, but the migrations and pgTAP behavior have not been executed by PostgreSQL on this machine. A clean `supabase db reset` followed by `supabase test db` on a supported local/CI runtime, and then remote Supabase execution, remain mandatory before production release.
