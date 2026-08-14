# Task 2 review fix 2 — ranking and access hardening

## RED evidence

- Added review-round-2 static fixtures and pgTAP contracts before migration 005.
- `node --test scripts/verify-meet-migrations.test.mjs` initially produced the intended RED result: 28 passed and 4 failed because schema version 5 and the three review invariants did not exist.
- Additional tests were then added before production work for owner-invitation escalation, invitation revocation, least-privilege member identity and RLS-backed access Realtime.

## Implemented

- Migration `202608140005_meet_ranking_and_access_hardening.sql` derives server rankings from stored bracket settings for competition, dense and ordinal modes and applies configured `totalWins`, `headToHead`, `matchesWon`, `averageTime`, `bestTime`, `laneBalance`, `carNumber` and `playoff` tie-break semantics in order.
- Caller ranks are checked against the server-authoritative domain-equivalent rank. Unresolved ordinal ties are rejected instead of receiving an arbitrary fallback.
- Equal-rank advancement candidates are allocated in stable UUID order, matching the Meet domain's locale-independent stable-ID order rather than car-number order.
- Authenticated direct car INSERT is restricted to registration columns. Advancement lineage columns remain writable only inside the advancement RPC.
- Admins cannot create owner invitations. Owners retain that ability.
- Added row-locked, role-scoped, audited and request-idempotent `revoke_invitation(invitation_id, request_id)` without raw-code disclosure.
- Added `list_organisation_members(organisation_id)`: active same-organisation members receive user ID, role and safe display identity; only owners/admins receive email; outsiders are denied and `auth.users` receives no direct client grant.
- Organisations, memberships and invitations are added to Supabase Realtime and remain protected by their existing RLS policies.

## Verification

- Static verifier: 36/36 tests passed; contract reports 15 RLS tables and 11 authenticated RPCs.
- pgTAP plans match assertions: advancement review 9/9, commands 40/40, review hardening 17/17, review round 2 19/19, RLS 32/32.
- `pnpm typecheck` passed.
- `pnpm test -- --run` passed 16 files and 205 tests.
- `git diff --check` passed.
- Secret-pattern scan across all round-2 paths returned no matches.

## Environment blocker

Neither Docker nor Podman is installed. PostgreSQL migration execution and pgTAP remain unavailable locally; a clean `supabase db reset` followed by `supabase test db` is mandatory on a supported runtime before release.

## Commit

- `fix: align Meet ranking and invitation access`
