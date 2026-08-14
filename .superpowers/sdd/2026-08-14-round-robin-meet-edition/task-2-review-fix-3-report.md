# Task 2 review fix 3 — preliminary results and safe identity labels

## TDD evidence

- Added static negative fixtures and pgTAP behavior tests before migration 006.
- The first verifier run was RED with 35 passed and 3 expected failures: schema version 6 plus the missing preliminary-only and neutral-label invariants.

## Implemented

- Migration `202608140006_meet_preliminary_and_identity_hardening.sql` redefines server advancement ranking so every completed-heat, winner, match, timing, head-to-head and lane-balance metric uses only `phase = 'preliminary'`.
- The existing transactional advancement function is patched in-place by the versioned migration to use a dedicated preliminary-only source-completeness helper, so pending or confirmed final-phase heats cannot affect qualifier readiness.
- The member directory accepts only trimmed, bounded explicit `display_name` metadata without control characters, angle brackets or `@`. Otherwise it returns a neutral `Member <short stable id>` label. Email remains available only in the separate owner/admin-only email field.
- pgTAP fixtures cover a confirmed final heat that reverses wins/times, a car scheduled only in final remaining preliminary-incomplete, and marshal/viewer email-local-part non-disclosure.

## Verification

- Static verifier: 38/38 passed; 15 RLS tables and 11 authenticated RPCs.
- pgTAP plan counts match assertions, including review round 3 at 6/6.
- `pnpm typecheck` passed.
- `pnpm test -- --run` passed 16 files and 205 tests.
- Diff check and staged secret-pattern scan passed.

## Environment blocker

PostgreSQL and pgTAP execution remain unavailable because Docker and Podman are absent. A clean `supabase db reset` and `supabase test db` remains mandatory on a supported runtime.

## Commit

- `fix: scope Meet advancement to preliminary results`
