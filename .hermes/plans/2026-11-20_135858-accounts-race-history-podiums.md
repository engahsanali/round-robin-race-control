# Accounts, Race History and Podiums Implementation Plan

**Goal**
Let organisers sign in from any device, recover their accounts and find their past events. Automatically track confirmed first, second and third places and calculate points using club rules.

**Architecture**
Keep the React race-day app and its scheduling logic. Add a managed identity provider and PostgreSQL with workspace-level authorisation. Retain independent bracket saves and revision checks. Use confirmed result records to power event history, podium counts and points.

**Proposed stack**
Keep React, Vite and Netlify Functions. Evaluate Supabase Auth and Postgres in a separate test project for email and password authentication, reset emails and database row-level security. Use Netlify Functions as the server boundary for private data and sessions. Validate the email sender, account recovery across devices and service costs before committing to the provider. [Supabase password-based authentication](https://supabase.com/docs/guides/auth/passwords) · [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 1. Accounts, profiles and privacy

- Add Sign up, Verify email, Sign in, Forgot password, Reset password and Sign out. Verify the new address when email changes. Use a one-time expiring password reset and a uniform response regardless of whether an address is registered. Test successful delivery as well as expired and already-used links. [OWASP password reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- Add a profile with name, nickname and timezone. Use the nickname as an optional display name. Put default entry fees and scoring rules in workspace settings. Keep account email and payment details private.
- Create a private workspace for each organiser. Store membership server-side. Verify membership for event lists, individual events, brackets, results, payments, exports and changes. Add a restricted scorer role when invited operators need it.
- Use server-managed sessions with secure, HttpOnly cookies and CSRF protection for cookie-authenticated writes. Rate-limit signup and recovery. Keep privileged database credentials on the server.
- Make events private by default. An organiser can publish a revocable spectator link. Expose an explicit list of display fields, such as class, chosen display names and confirmed results. Keep payments, full private rosters and audit history out of that response.
- Keep browser recovery scoped to the signed-in account and workspace. Clear private UI state at sign-out. Preserve pending offline edits for the same account on a trusted device. Require reauthentication for private cloud sync and prevent a later user on a shared browser from reading or replaying those edits. Decide how pending edits are secured before enabling offline caching for signed-in users.

**Likely implementation paths**
Add `webapp/src/auth.ts`, account/profile screens and `webapp/netlify/functions/auth.ts`. Rework authorisation in `webapp/netlify/functions/events.ts` and account scope in `webapp/src/App.tsx` and `webapp/src/store.ts`. Add workspace, membership and profile migrations under `webapp/supabase/migrations/`.

**Acceptance**
Use separate accounts A and B, including on the same browser in sequence. Account B cannot list, open, export or change account A's events, fees, recovery data or results. A published spectator link returns only the intended public fields. Revoking it takes effect on subsequent reads.

## 2. Keep existing events and build My Events

- Add **My Events** with active and completed events, search by name, and date and class filters. Show saved rosters, draws, individual heat results, wins and losses, fees, prizes and available activity to authorised organisers. Link each history row to the event and its confirmed results.
- Back up the existing store and rehearse migration on an isolated environment. Preserve event IDs, category and bracket IDs, entrants, recorded wins, payments, prize credits, revisions, and the audit entries that still exist. Reconcile counts and totals against representative older events, including four-category events. Show unavailable historical activity as missing.
- Let a signed-in organiser claim a legacy event by proving possession of its saved private admin link, including a key already held by their browser. Make claims atomic, idempotent and audited. Route missing-key cases through a verified support process. Leave ambiguous ownership unassigned.
- Cut over after migration and claim tests pass. Keep the archived source restricted and verify old Netlify deploy URLs and previews cannot expose live records. Prevent concurrent writes to the old and new stores during cutover, and document how read-only access and pending browser edits will be handled. [Netlify Blobs deployment scope](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores)
- Treat historic Excel spreadsheets as a second input. Start with a configurable CSV import or XLSX import after reviewing a representative sheet. Preview mapped columns, duplicate rows, and unmatched names, then ask the organiser to confirm before writing anything. Track import provenance and prevent duplicate imports.

**Likely implementation paths**
Add a My Events screen and workspace-scoped history endpoints. Extend `webapp/src/types.ts` and `webapp/src/store.ts`. Keep revision handling in `webapp/src/sync.ts` and test it against the migrated storage. Add migration and reconciliation tooling under `webapp/scripts/`.

**Acceptance**
A claimed event is visible to its organiser after signing in on another device. Its bracket results and fee totals reconcile with the source. Repeating the claim or import produces one record. Verify restore from backup before production cutover.

## 3. Confirm and record first, second and third

- Keep live standings by wins. The current engine uses car number as a display sort for equal wins. It is not a tie-break rule. Select the deciding final for each event category, and attach any rerace used to resolve a podium tie. Preliminary brackets and unrelated finals remain separate.
- Suggest places after deciding heats finish. Flag ties that affect the podium and require the configured tie-break or authorised organiser confirmation. Require confirmation before a podium counts in history. When data is incomplete, show the result as unconfirmed. Allow fewer than three places when fewer than three finishers are eligible.
- Record place, event, class, competitor, car number, result source, revision and confirming organiser. Add stable competitor IDs within each workspace. Keep the car-entry ID and the name or nickname as it appeared on race day. Offer manual linking for older entries with similar names.
- Show a podium on each event or category page and a competitor report with first, second and third place counts. Preserve prior confirmed revisions when a result is corrected. Recalculate points once from the new confirmed version.

**Likely implementation paths**
Keep `standings()` in `webapp/src/domain.ts` as the source for group ranks. Add `webapp/src/results.ts` and `webapp/src/results.test.ts` for podium rules. Add Results UI and an API confirmation operation. Keep confirmed results in a persistence scope separate from live bracket edits and fees.

**Acceptance**
Test ties at first and third, multiple finals, reraces, renamed racers, separate racers with the same nickname, corrected podiums and repeat confirmation. Confirm that selecting a deciding final and recording places leaves the original heat results intact.

## 4. Automate the spreadsheet tally

- Keep heat wins and losses separate from championship points. Use an organiser-defined points table by finishing position. Confirm the rule from a real spreadsheet before setting a default, including participation points, multiple cars per competitor and how ties or disqualifications score.
- Store the rule version used for each event or season. Compute standings from confirmed results. Provide per-event points and season totals filtered by class and competitor. Add CSV export of standings and the entries behind each total, alongside the current race results export.
- Reconcile one real historical event or season against the Excel tally before rollout. Display provisional points separately while podiums are unresolved. Record corrections so past calculations can be explained.

**Likely implementation paths**
Add `webapp/src/points.ts` and `webapp/src/points.test.ts`. Extend the results/history routes and the export flow around `eventToCsv()` in `webapp/src/domain.ts`.

**Acceptance**
The sample season matches the spreadsheet totals. Running a tally a second time leaves points unchanged. An approved podium correction updates the right competitor once and leaves unrelated events and seasons intact.

## Release sequence

1. Build account and workspace isolation in staging. Verify reset email, shared-browser sign-out, authorisation and spectator revocation.
2. Rehearse migration with backups. Pilot My Events and legacy claiming with trusted organisers.
3. Pilot confirmed podiums, then compare automated points with a real Excel tally. Confirm the decisions about final brackets, ties and points with the organiser.
4. Run unit tests, build, desktop/mobile E2E, browser recovery and deployed concurrency tests. Add two-account isolation and import regression tests. Publish only after migration, restore and legacy-access checks pass.
