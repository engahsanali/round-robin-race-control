# Round Robin Race Control — Meet Edition Design

Date: 2026-08-14
Status: Approved for implementation by the user's detailed Meet Edition specification
Release base: `origin/main` at `3c99ee58cab7b9b0dfba6f2d388ed40212dcfdf1`

## 1. Outcome and non-regression boundary

Add a third hosted edition, **Round Robin Race Control Meet**, without changing the runtime behavior or deployment configuration of Solo or Pro. Meet lives at `apps/meet`, reuses the proven `@rr3/domain` and `@rr3/scheduler` packages, and adds a new framework-independent `@rr3/meet-domain` package.

Meet is one dense, accessible workbook workspace for an entire meeting. Normal race operation never switches routes. Authentication callbacks may reload the root document, and dialogs, drawers, anchored bracket sheets, print views, and mobile selectors are allowed.

The release target is the existing public repository and a third independent Netlify project:

- GitHub: `engahsanali/round-robin-race-control`
- Netlify project: `round-robin-race-control-meet`
- Preferred URL: `https://round-robin-race-control-meet.netlify.app/`

Solo and Pro projects, URLs, code paths, build outputs, and Netlify configuration remain untouched.

## 2. Architecture

```text
apps/meet/
  src/app/                 shell, providers, auth boundary, error boundary
  src/features/            meet setup, bracket sheets, advancement, audit, admin
  src/data/                typed Supabase repository and realtime subscriptions
  src/state/               query cache, commands, optimistic version handling
  src/styles/              workbook tokens, responsive and print styles
packages/meet-domain/
  src/schema.ts            versioned Meet schema and validation
  src/progression.ts       graph validation, previews, cutoff/tie rules
  src/commands.ts          pure meet/bracket mutations and audit payloads
  src/serialization.ts     JSON import/export and cross-edition conversion
  src/reporting.ts         safe CSV and print projections
supabase/
  migrations/              version-controlled schema, RLS, RPC functions
  seed.sql                 deterministic demo organisation and meet data
  tests/                   pgTAP RLS, role, isolation, and transaction tests
tests/e2e/
  meet-*.spec.ts           auth, workbook, progression, concurrency, deployment
```

The browser uses `@supabase/supabase-js` with only `VITE_SUPABASE_URL` and the publishable/anon key. Important writes use PostgreSQL RPC functions, not direct client-side table composition. The database uses `auth.uid()`, RLS, role checks, version columns, unique constraints, and transactions. No service-role credential is shipped or required by the browser.

## 3. Meet domain model

Meet schema version 1 wraps independent bracket events rather than interpreting event categories as brackets.

- `Organisation`: id, name, slug, owner, timestamps.
- `Membership`: organisation, user, role (`owner`, `admin`, `organiser`, `marshal`, `viewer`), status.
- `Meet`: identity, venue, date, status, settings, optimistic `version`.
- `Bracket`: stage (`qualifier`, `semifinal`, `final`), display order, status, independent event settings and version.
- `Participant`: bracket-scoped person identity and contact details.
- `Car`: bracket-scoped car identity, number, name, owner and active state. Car-number uniqueness is enforced only inside a bracket.
- `Heat`: bracket-scoped three-lane schedule row, phase/status, winner, lane times and version.
- `AdvancementRule`: source bracket, destination bracket, top-N count, destination capacity/order and status.
- `AdvancementSnapshot`: source result version, selected cars, cutoff/tie state, confirmation actor/reason/time and stale flag.
- `AuditEvent`: organisation, meet, optional bracket, actor, action, entity, before/after JSON, reason, timestamp and request id.
- `SecurityEvent`: sign-in/account and membership actions visible only to organisation admins.

At least 15 brackets and 12 cars per typical qualifier are supported. Collection and text limits are explicit. Advancement edges must form a directed acyclic graph. Destination capacity, duplicate source car, duplicate advancement, bracket-stage ordering, and circular progression are rejected.

## 4. Progression rules

The progression engine is pure and deterministic:

1. Calculate standings independently for each source bracket with existing ranking rules.
2. For each `top N` edge, select resolved places above the cutoff.
3. Surface tied cutoff groups without silently selecting by car number.
4. Allocate selected cars to one or more destination brackets using the rule's stable destination order and balanced round-robin distribution.
5. Return a preview with selected, excluded, tied, duplicate, capacity, and stale-source facts.
6. Require explicit confirmation before inserting destination participants/cars.
7. Permit manual adjustment only with a bounded non-empty reason; record before/after and actor in the audit.

`confirm_advancement` runs in one database transaction. It locks relevant rule, source brackets, snapshots and destination brackets, rechecks versions and permissions, inserts destination entrants with source lineage, records the snapshot/audit, and increments versions. Repeated confirmation is idempotent and duplicate advancement is constrained at the database level.

If upstream results change after confirmation, the result RPC marks dependent snapshots stale. The UI shows a recalculation warning and blocks further downstream advancement until an authorised organiser reviews and reconfirms or replaces the snapshot.

## 5. Accounts, organisations and permissions

Supabase Auth provides email/password sign-up, sign-in, sign-out, email confirmation and password recovery with a safe allow-listed root redirect. Open signup is enabled because the user explicitly requires sign-up. New users create or join an organisation before accessing production data.

Roles are enforced in RLS and RPC functions:

| Capability | Owner/Admin | Organiser | Race Marshal | Viewer |
|---|---:|---:|---:|---:|
| Manage organisation/members | yes | no | no | no |
| Create/configure meets and brackets | yes | yes | no | no |
| Register cars and generate schedules | yes | yes | limited | no |
| Confirm/correct race results | yes | yes | yes | no |
| Preview/confirm advancement | yes | yes | no | no |
| Read, export and follow realtime | yes | yes | yes | yes |

Owners create single-use organisation invitation codes. Codes are generated with cryptographic randomness, stored only as hashes, expire, and are entered into the app rather than placed in URLs or logs. This avoids requiring a service-role key for invitations. Owners can revoke invitations and remove non-owner members. The final owner cannot be removed.

Every user-owned table has RLS enabled and no permissive anonymous policy. Organisation membership is checked through stable security-definer helper functions with a fixed `search_path`. Demo mode uses compiled seed data in memory and never queries or displays production tables.

## 6. Data integrity and concurrency

- Each mutable meet, bracket and heat row has an integer version.
- Winner and advancement RPCs require `expected_version`; mismatches return a structured conflict.
- Winner confirmation validates lane membership, heat status, role, bracket/meet status and supplied times.
- Corrections require a reason and preserve prior result history.
- Audit insertion occurs in the same transaction as every important mutation.
- Realtime subscriptions publish only authorised rows allowed by RLS.
- Offline or failed writes remain visibly pending or failed; the UI never claims saved before the server response.
- The client offers retry only after reloading the current server version and showing the conflict.
- JSON import validates the complete meet graph before a transactional replacement into a new meet id.

## 7. Single-page workbook experience

The sticky toolbar contains meet identity, venue/date, connection/save status, current role, setup, registration, progression, audit, backup, print, expand/collapse and sign-out controls.

The desktop workspace contains:

- sticky stage/bracket index with completion, stale and attention indicators;
- semantic SVG progression map from qualifiers through semifinals to final;
- compact setup and bulk registration drawers;
- anchored collapsible bracket sheets with cars, schedule, live race controls, progress, standings, cutoff, advancing cars and winner;
- overall finals/meet results and searchable audit timeline below sheets;
- frozen table headers and first identity columns;
- table-contained horizontal overflow only;
- lazy rendering of collapsed sheet details.

Mobile replaces the bracket index with a selector, shows compact cards, and keeps the active heat/winner controls persistently reachable. The same DOM order and actions are preserved. Buttons are at least 44px, focus is visible, status is not color-only, dialogs have initial focus/Escape/focus return, and reduced motion removes nonessential transitions.

Print CSS expands selected/all sheets, repeats headers, avoids split heat rows, hides controls and includes progression, advancement, results, audit summaries and the exact creator credit.

## 8. Operational tracking

Meet completion, bracket completion, current/next heat, advancement state, result corrections, actor/timestamp/action/before/after, sign-in and membership security events are first-party operational records. The admin dashboard shows active meets, stale advancement, unresolved ties and recent authorised activity.

No advertising trackers or third-party analytics are included. Realtime presence is limited to authorised meet subscribers and does not persist invasive device data.

## 9. Security controls

- RLS on every organisation-owned table, tested with owner, organiser, marshal, viewer, outsider and anonymous identities.
- `SECURITY DEFINER` functions have fixed `search_path`, explicit permission checks and revoked public execution unless intentionally granted to authenticated users.
- Zod validation in domain/client and SQL validation/constraints/RPC checks on important writes.
- React text rendering only; no imported HTML execution.
- CSV cells protect against leading formula characters.
- Auth callbacks allow only the deployed origin/root; tokens are not logged or manually copied into URLs.
- CSP, HSTS, COOP, nosniff, frame denial, permissions policy and referrer policy are configured in Meet's own `netlify.toml`.
- Sensitive values remain in environment settings; `.env*` and Supabase temp/config secrets stay ignored.
- Rate limits apply to invite generation/redemption and sensitive RPCs through a database-backed per-user window.
- Intended commits and repository history are scanned for token/password/key patterns before publication.

## 10. Testing and release gates

Unit/property tests cover 15 independent brackets, repeated car numbers across brackets, three-qualifier and four-qualifier progression, multiple destinations, ties, corrections, stale advancement, manual reasons, invalid graphs, serialization and formula-safe exports.

Database tests use Supabase CLI/pgTAP to prove every RLS policy, role boundary, organisation isolation, invitation lifecycle, winner transaction, advancement transaction and optimistic conflict. Integration tests use two organisations and at least two users.

React tests cover auth states, workbook virtualization/lazy sheets, permission-specific controls, realtime/save states and accessible dialogs. Chromium E2E covers signup/signin/signout/recovery, setup, registration, schedules, racing, standings, qualifier advancement, semifinals, final, audit/export/restore, multi-user conflict, demo isolation, mobile/tablet/desktop overflow and keyboard operation.

Release is blocked until:

1. Existing Solo and Pro gates pass unchanged.
2. Meet unit, integration, RLS and E2E gates pass.
3. Production build and verifier pass.
4. Intended changes and repository history pass secret scans.
5. `main` equals the pushed GitHub commit.
6. All three Netlify URLs are public and HTTP 200.
7. Deployed Meet uses the production Supabase project with two-user organisation isolation proven.

## 11. Deployment

Meet's Netlify build runs from repository root:

- Build: `pnpm --filter @rr3/meet build`
- Publish: `apps/meet/dist`
- Functions: none required for core operation; authenticated database RPCs own important mutations.
- Public environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

The Meet site connects to `main` for continuous deployment. Existing Solo and Pro Netlify projects are not relinked, reconfigured or redeployed except for final read-only HTTP verification.

## 12. External setup boundary

Implementation can proceed locally through migrations, tests and build without production credentials. Creating/linking the Supabase project, enabling email Auth, applying production migrations, creating test users, setting Netlify variables and verifying live RLS requires authenticated Supabase access. If the installed plugin/CLI cannot obtain that access automatically, this is the only expected user-authentication gate.
