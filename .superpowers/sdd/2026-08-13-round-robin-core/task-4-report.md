# Task 4 Report: Results, Rankings, and Finals

## Status

Complete in the isolated `agent/dual-editions` worktree.

Implementation commit: `cf9dd14 feat: add auditable standings and finals engine`

## Delivered

- Added immutable, schema-validated `recordWinner`, `cancelHeat`, and `markRerun` commands for preliminary and final heats.
- Added idempotent winner reconfirmation, reason-required winner correction, official-result removal for cancellation/rerun, and human-readable audit entries that preserve the old winner.
- Added pure phase-separated standings with stable car/participant IDs, per-match and total wins, matches won, completed heats, timing, lane balance, head-to-head records, and recent form; inactive entries are excluded.
- Added competition, dense, and guarded ordinal ranking with tie-break evaluation in configured order.
- Added head-to-head mini-table scoring within the currently tied group, nullable timing handling, explicit optional car-number tie breaking, and stable-ID UI ordering visibly labeled non-competitive when a tie remains.
- Added `explainRank` proof output and finals cutoff decisions with automatic qualifiers, tied cutoff entrants, and `include-all | playoff | manual-with-reason` actions.
- Exported all Task 4 functions and JSON-friendly public types from `@rr3/domain`.

## TDD and Verification Evidence

All commands prepended `C:\Users\engah\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` to `PATH`.

1. RED command:

   `pnpm vitest run packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts`

   Outcome: exit 1 as expected; all three suites failed because `./results`, `./rankings`, and `./finals` did not exist.

2. First GREEN command:

   `pnpm vitest run packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts`

   Outcome: exit 0; 3 test files and 20/20 tests passed.

3. Specified tests plus typecheck after strict-index fixes:

   `pnpm typecheck; pnpm vitest run packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts`

   Outcome: exit 0; `tsc -b --pretty false` completed with zero type errors, then 3 test files and 20/20 tests passed.

4. Fresh full-project verification before commit:

   `pnpm test`

   Outcome: exit 0; 8 test files and 107/107 tests passed.

5. Diff hygiene and implementation commit:

   `git diff --check; git add -- packages/domain/src/results.ts packages/domain/src/rankings.ts packages/domain/src/finals.ts packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts packages/domain/src/index.ts; git diff --cached --check; git commit -m "feat: add auditable standings and finals engine"`

   Outcome: exit 0; no whitespace errors and commit `cf9dd14` created with seven changed files.

## Self-review

- Every Task 4 behavior was exercised against real pure functions without mocks; all expected values are literal or independently constructed.
- Result commands validate the complete incoming state before mutation and preserve the prior object/arrays; reconfirming the same completed winner returns the original object without adding duplicate audit history.
- Only completed heats contribute standings, and the schema guarantees their winner is assigned to the heat. Scheduled, cancelled, and rerun heats contribute no official win.
- Competitive equality is determined only by configured keys. Stable ID is used solely for deterministic display ordering and is explicitly marked non-competitive; car number affects rank only when configured.
- Finals selection filters inactive, unranked, and no-completed-heat rows before applying cutoff logic, so empty state cannot produce a podium or finalist.

## Concerns / Assumptions

- The plan names `Standing`, `RankedStanding`, `RankProof`, and `QualificationDecision` but does not prescribe their fields. The implementation uses explicit JSON-compatible objects that contain the design specification's required facts and avoids position-based identifiers.
- The command interface has no clock or audit-ID dependency. Audit timestamps therefore use the state's existing `event.updatedAt`, while collision-safe IDs are derived from action, heat ID, and audit sequence; application command handlers may update event time before invoking these functions.
- `allowSharedRanks: false` does not authorize an arbitrary fallback tie break. Unresolved competition/dense ties remain visible, while ordinal mode rejects unresolved ties as required by the design.
- Git emitted the repository's existing LF-to-CRLF checkout warnings during staging; both unstaged and cached `git diff --check` were clean.

## Review Fix Round 1

Resolved all three Important review findings.

- Result commands now reject audit writes at the 10,000-entry schema limit, cap all audit reasons at 500 trimmed characters, generate compact hashed audit IDs for maximum-length heat IDs, and validate the complete returned state before returning it.
- Ranking now detects that official results exist from active entrants' completed participation rather than requiring an active entrant to retain the official win. An inactive winner therefore cannot erase the active field's podium state.
- Rank proof resolution is now recorded per resulting partition. A key that separates a unique leader from a still-tied pair is resolved for the leader but remains unresolved for both members of that pair.

### Round 1 TDD evidence

1. RED command:

   `pnpm vitest run packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts`

   Outcome: exit 1 with exactly five focused regression failures and 20 passes: overlength generated audit ID, full audit-log append, overlength reasons, inactive-winner official-result detection, and tied-partition proof resolution.

2. GREEN command:

   `pnpm vitest run packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts`

   Outcome: exit 0; 3 test files and 25/25 tests passed.

3. Full verification:

   `pnpm check`

   Outcome: exit 0; `tsc -b --pretty false` completed with zero type errors, then 8 test files and 112/112 tests passed.
