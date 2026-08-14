# Task 2.5 review fix round 1 — registration reassignment audit

## Review finding

Migration 007 captured a car reassignment's prior participant by joining the incoming `participantId`. For a car moved from participant A to participant B, the audit therefore paired participant B with the pre-change car that still referenced participant A.

## TDD evidence

- Added four pgTAP assertions first: the audit `before_state` participant and car participant ID must both be A; the `after_state` participant and car participant ID must both be B.
- Added a static negative fixture requiring prior participant resolution through the existing car.
- The RED verifier run failed because the newly required migration 008 was absent (`missing_migration`); the focused negative invariant passed.

## Fix

- Added only `202608140008_registration_audit_reassignment.sql`; applied migration 007 was not edited.
- Migration 008 replaces `save_registration_batch` with the same fixed-search-path, role, version, idempotency, lineage, schedule, stale-propagation and atomic audit controls.
- The before snapshot now resolves `existing_car` by incoming `carId`, then resolves `previous_participant` from `existing_car.participant_id`. The after snapshot continues to resolve the participant from the saved car.

## Verification

- Static migration verifier: 49/49 passed; schema version 8, 15 RLS tables and 14 required RPCs.
- Workbook pgTAP plan: 65/65 assertions by exact assertion count.
- PostgreSQL parsing: migration 008 outer SQL, its PL/pgSQL body and the updated pgTAP file parsed successfully.
- Root `pnpm check`: TypeScript build passed; 16 test files and 205 tests passed.
- Scoped diff check and staged secret scan are recorded immediately before the focused commit.
- Live pgTAP execution remains unavailable without the local Supabase PostgreSQL/Docker runtime documented in Task 2.5.
