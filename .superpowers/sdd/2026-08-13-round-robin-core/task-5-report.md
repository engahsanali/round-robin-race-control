# Task 5 Report: Payments, Persistence, and Safe Exports

## Status

Complete in the isolated `agent/dual-editions` worktree.

Implementation commit: `86ecbc1 feat: add safe event accounting and interchange`

## Files Changed

- `packages/domain/src/payments.ts`
- `packages/domain/src/payments.test.ts`
- `packages/domain/src/serialization.ts`
- `packages/domain/src/serialization.test.ts`
- `packages/domain/src/csv.ts`
- `packages/domain/src/csv.test.ts`
- `packages/domain/src/index.ts`

## Delivered

- Added pure participant and event accounting in integer cents, including quantity-based charges, signed payment/refund collection, balances, credits, safe-integer overflow guards, and explicit rejection of missing or invalid accounting inputs.
- Added deterministic schema-version-1 serialization with recursive object-key ordering, JSON parsing into a temporary value, dangerous-key rejection before migration, explicitly version-gated migration, final acceptance through the shared event validator, and discriminated success/failure results.
- Added RFC-style CSV field escaping with CRLF row separators, Unicode preservation, doubled quotes, embedded newline handling, and formula-injection protection after optional leading whitespace.
- Added deterministic registration, fees, results, standings, and audit row builders. Audit detail objects use stable recursive key ordering.
- Exported Task 5 functions and JSON/framework-independent public types from `@rr3/domain`.

## TDD and Verification Evidence

All commands prepended `C:\Users\engah\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` to `PATH`, because the shell's fallback `pnpm.cmd` could locate its bundled runtime but child package scripts could not initially resolve `node`.

1. Initial RED command:

   `pnpm vitest run packages/domain/src/payments.test.ts packages/domain/src/serialization.test.ts packages/domain/src/csv.test.ts`

   Outcome: exit 1 as expected; all three suites failed before collection because `./payments`, `./serialization`, and `./csv` did not exist.

2. Initial GREEN command:

   `pnpm vitest run packages/domain/src/payments.test.ts packages/domain/src/serialization.test.ts packages/domain/src/csv.test.ts`

   Outcome: exit 0; 3 test files and 39/39 tests passed after correcting one test expectation to account for normal CSV quoting around a protected formula containing quotes.

3. Type checking:

   `pnpm typecheck`

   First outcome: exit 1 on three intentionally imported JSON fixture casts; no production-code error. The fixture casts were made explicitly type-safe through `unknown`.

   Final outcome: exit 0; `tsc -b --pretty false` completed with zero type errors.

4. Deterministic audit export self-review RED/GREEN:

   `pnpm vitest run packages/domain/src/csv.test.ts`

   RED outcome: exit 1 with exactly one regression failure showing nested audit-detail key insertion order changed CSV bytes.

   After minimal stable-key serialization, the exact three-file focused command passed with 3 test files and 40/40 tests.

5. Fresh final focused verification:

   `pnpm vitest run packages/domain/src/payments.test.ts packages/domain/src/serialization.test.ts packages/domain/src/csv.test.ts`

   Outcome: exit 0; 3 test files and 40/40 tests passed.

6. Fresh final type and project verification:

   `pnpm typecheck`

   Outcome: exit 0.

   `pnpm check`

   Outcome: exit 0; type checking completed with zero errors, then 11 test files and 152/152 tests passed.

7. Diff hygiene and implementation commit:

   `git diff --check; git add -- <seven Task 5 source/test files>; git diff --cached --check; git commit -m "feat: add safe event accounting and interchange"`

   Outcome: exit 0; no whitespace errors and implementation commit `86ecbc1` created with only the seven Task 5 source/test files.

## Self-review

- Accounting derives charges from the current category-price configuration and rejects unsafe, fractional, negative, missing, or overflowed values rather than rounding or coercing them.
- Import never receives or mutates a current event object. Parsing, migration, cloning, and shared validation all occur on a temporary parsed value, and tests compare the existing state's serialized bytes after failure.
- The existing shared validator remains the single full event contract for duplicate IDs, active car numbers, references, winners, money, and times. Serialization performs only the required dangerous-key/version gates before delegating final validation.
- CSV formula protection is applied to every cell, including strings with leading whitespace and negative numeric-looking values, before ordinary CSV quoting.
- Tests exercise real pure functions without mocks, and expectations use hand-derived literals or independently constructed fixtures.

## Concerns / Assumptions

- No historical event schema is defined anywhere in the approved design or Tasks 1-4. `migrateEvent` therefore explicitly supports version 1 as an identity migration and rejects every other or missing version; future historical versions require an explicit migration branch and tests.
- The plan requires report-specific row builders but does not prescribe names or exact column layouts. The public API uses `buildRegistrationRows`, `buildFeesRows`, `buildResultsRows`, `buildStandingsRows`, and `buildAuditRows`, with stable-ID columns retained throughout.
- `serializeEvent` returns normalized validated state (including the schema's existing string trimming) with recursively sorted object keys and a final newline. Array order is preserved because participant, entry, heat, payment, and audit ordering is meaningful event data.
- Git emitted the repository's existing LF-to-CRLF checkout warnings during staging; both unstaged and cached `git diff --check` were clean.
