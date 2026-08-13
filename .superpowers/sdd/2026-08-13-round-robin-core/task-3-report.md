# Task 3 Report: Deterministic Custom Schedule Optimizer

## Status

Complete in the isolated `agent/dual-editions` worktree.

Implementation commit: `48880d0 feat: add deterministic fair schedule optimizer`

## Delivered

- Added `@rr3/scheduler` with deterministic `seedToUint32(seed)` and `mulberry32(seed)` exports.
- Added `generateCustomSchedule(carIds, options)` returning generated `Heat[]` records and the required eight-part lexicographic score.
- Added seeded valid construction, rotating byes, two-car heat handling, lane balancing, seeded swaps/three-cycles, deterministic stable-key tie breaking, and a fixed operation budget with no wall-clock stopping condition.
- Added runtime input validation for 3-24 unique non-empty stable car IDs, 1-10 matches, string seeds, and positive integer search controls.
- Added unit and bounded fast-check property coverage for determinism, seed variation, every entrant/match boundary, validity, fairness, stable IDs, byes, two-car heats, and comparison with the specified sequential baseline entrant counts.
- Updated the pnpm lockfile with the scheduler workspace importer.

## TDD and Verification Evidence

All commands used the bundled Node runtime by prepending `C:\Users\engah\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` to `PATH`.

1. RED command:

   `pnpm vitest run packages/scheduler/src/generate.test.ts`

   Outcome: exit 1 as expected; 1 failed suite, no tests collected, because `./generate` did not exist.

2. First GREEN unit command:

   `pnpm vitest run packages/scheduler/src/generate.test.ts`

   Outcome: exit 0; 1 test file passed and 29/29 tests passed in 12.33 seconds total.

3. Specified combined verification plus typecheck:

   `pnpm vitest run packages/scheduler/src/generate.test.ts packages/scheduler/src/generate.property.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm typecheck`

   Outcome: exit 0; 2 test files passed, 30/30 tests passed, and `tsc -b --pretty false` completed with zero type errors.

4. Fresh full-project verification before commit:

   `pnpm check`

   Outcome: exit 0; `pnpm typecheck` passed, then 5 test files passed with 85/85 tests passing in 21.62 seconds total.

5. Diff hygiene:

   `git diff --check`

   Outcome: exit 0 with no whitespace errors.

6. Implementation commit:

   `git add -- pnpm-lock.yaml packages/scheduler; git diff --cached --check; git commit -m "feat: add deterministic fair schedule optimizer"`

   Outcome: exit 0; commit `48880d0` created with seven changed files and no staged whitespace errors.

## Self-review

- The generated score is independently recomputed in unit tests rather than asserted through a production scoring helper.
- Search defaults remain 24 restarts and 1,500 iterations per restart before deterministic capping. Actual search satisfies `entrants * matches * restarts * iterations <= 250,000`.
- The sequential schedule is included as a known starting candidate, so optimization cannot return a lexicographically worse candidate than that baseline.
- A separate lane pass preserves opponent groupings while greedily minimizing lane spread.
- Generated heat IDs, match/heat numbers, lane tuples, status, winner, timing, and notes satisfy the canonical `Heat` type and `analyseSchedule` never reports generated output as invalid in the bounded property suite.

## Concerns / Assumptions

- The plan names `GeneratedSchedule` but does not define its fields. The implementation uses the minimal inspectable shape `{ heats, score }`; `score` is the exact tuple ordered in the Task 3 brief.
- Git emitted the repository's existing LF-to-CRLF checkout warnings during staging; `git diff --check` remained clean.
- No change to `packages/domain/src/schedule-quality.ts` was needed because the existing committed analyzer already supplied the required validity checks.

## Review Fix Round 1

Resolved both Important findings from the first scheduler review.

- Two-car lane assignment now permutes the vacant `null` slot together with the two entrants. The same deterministic greedy lane-count objective balances entrant lanes and the vacant lane instead of fixing every vacancy in lane 3.
- Scheduler pair keys now use a JSON-serialized sorted ID array, so distinct opaque-ID pairs such as `("a", "b::c")` and `("a::b", "c")` cannot collide.
- The independent test scorer uses its own unambiguous pair counter rather than relying on the domain analyzer's delimiter-formatted reporting keys.

### Round 1 TDD evidence

1. RED command:

   `pnpm vitest run packages/scheduler/src/generate.test.ts`

   Outcome: exit 1; 2 regression failures and 29 passes. The five-entrant/ten-match fixture reported lane spread 2 instead of at most 1, and delimiter-containing IDs produced scheduler pair metrics `119/9` instead of the independently calculated `110/5`.

2. Focused GREEN command after the production fix:

   `pnpm vitest run packages/scheduler/src/generate.test.ts`

   Outcome: exit 0; 31/31 tests passed.

3. First combined verification:

   `pnpm vitest run packages/scheduler/src/generate.test.ts packages/scheduler/src/generate.property.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm typecheck`

   Outcome: scheduler tests passed 32/32, then typecheck exited 1 on generic permutation and nullable-map annotations. No behavioral failure remained.

4. Fresh combined verification after correcting only those annotations:

   `pnpm vitest run packages/scheduler/src/generate.test.ts packages/scheduler/src/generate.property.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm typecheck`

   Outcome: exit 0; 2 test files and 32/32 tests passed in 10.32 seconds, then `tsc -b --pretty false` completed with zero type errors.

5. Diff hygiene:

   `git diff --check`

   Outcome: exit 0 with no whitespace errors.
