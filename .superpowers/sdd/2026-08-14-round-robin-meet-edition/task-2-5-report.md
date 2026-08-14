# Task 2.5 report — workbook command transactions

## TDD evidence

- Added the workbook-command verifier, ten negative mutation fixtures and a 61-assertion pgTAP contract before migration 007.
- The first static run was RED because the newly required `202608140007_meet_workbook_commands.sql` did not exist. The positive contract reported `missing_migration`; the independent negative invariant tests passed.
- Migration 007 was then implemented. Review findings were converted into additional RED tests before fixing schedule/lineage consistency, shared-capacity determinism, post-advancement lifecycle handling, audit retention and immutable entity-level audit history. The final static suite is GREEN at 48/48.

## Implemented contracts

- `save_meet_workbook(organisation, meet, expected version, workbook JSON, request ID)` creates or version-updates one complete Meet workbook in a row-locked transaction. It accepts 1–15 independent bracket definitions, validates bounded fields, unique UUIDs/display order, source/destination membership, forward stage order, an acyclic graph, consistent shared-destination capacities and deterministic capacity allocation, then writes an idempotent receipt plus bounded per-meet/bracket/rule before-and-after audit records.
- Structural bracket/rule changes are rejected once advancement snapshots exist, while harmless meet metadata/status changes remain possible without double-allocating cars or changing source-result versions. Omitted brackets/rules with operational history are also protected, and client-provided IDs cannot cross a Meet or organisation boundary.
- `save_registration_batch(bracket, expected version, rows JSON, request ID)` atomically upserts bounded participant/car identity and active state. Car numbers remain unique within a bracket but reusable in another bracket. Duplicate rows, cross-bracket IDs, withdrawal while referenced by any pending or confirmed heat, direct or indirect advancement-lineage mutation and destination sibling-car identity rewrites are rejected before writes. Every row change retains its participant/car before-and-after state, and corrections to an already-advanced source recursively mark current/downstream snapshots stale with a returned warning count.
- `activate_bracket_schedule(bracket, expected version, schedule JSON, replacement reason, request ID)` validates deterministic seed/quality metadata, unique heat IDs/positions, 2–3 distinct active lane cars and one appearance per car per round. It recomputes opponent-repeat, lower-bound, pair-frequency, per-car burden, appearance and lane-balance metrics server-side before trusting the candidate. It replaces pending rows only, requires a reason for a pending-schedule replacement, retains immutable retired/activated heat snapshots, and hard-blocks every replacement when confirmed results exist.
- Browser lane times have separate millisecond winner/correction wrappers. A fixed-search-path private helper accepts bounded integer milliseconds only and converts them exactly to `numeric(12,3)` seconds by division by `1000::numeric`.
- Direct authenticated write grants for Meet setup, registration, schedule and progression tables are revoked in migration 007, so the authoritative RPC validation cannot be bypassed through arbitrary table mutations. RLS reads and authorised Realtime remain unchanged.
- All new public RPCs derive the actor from `auth.uid()`, use fixed/empty search paths, expected versions, row locks, request-ID idempotency, same-transaction audit/version updates, revoked public/anon execution and exact authenticated grants.

## Verification

- Static migration verifier: 48/48 passed; contract reports 15 RLS tables and 14 required authenticated RPCs.
- PostgreSQL grammar check with `pglast`: migration 007 outer SQL, all four PL/pgSQL bodies and both touched pgTAP files parsed successfully.
- pgTAP plan count: workbook command file 61/61 assertions; the existing RLS plan remains 32/32 after its direct-write expectations were tightened to RPC-only.
- `pnpm check`: TypeScript build passed; 16 test files and 205 tests passed.
- `git diff --check`: passed for the scoped tracked changes. Staged diff/secret scanning is performed immediately before commit.

## Runtime limitation

`supabase test db` cannot execute in this environment because no local Supabase PostgreSQL is listening at `127.0.0.1:54322`, and Docker/Podman are absent. The CLI returned `LegacyDbConnectError` and explicitly requires `supabase start`. A clean database reset plus all pgTAP tests on a supported local/CI runtime, followed by production Supabase execution, remains a release gate.

## Deliberate scope boundary

Registration does not add mutable paid/fee amounts to `cars`. Reliable money tracking requires a normalized, append-only payment ledger with correction history and its own audit design; silently adding mutable cents fields would weaken accountability. This bounded command layer keeps registration to identity and active/withdraw/restore state.

## Commit

- `feat: add Meet workbook command transactions`
- The final SHA is reported by the agent after the scoped commit is created.
