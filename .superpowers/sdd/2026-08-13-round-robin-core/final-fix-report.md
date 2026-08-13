# Integrated Core Correction Report

## Status

Complete in the isolated `agent/dual-editions` worktree.

Implementation commit message: `fix: align scheduler fairness certificates`

## Delivered

- Replaced the abbreviated weighted-repeat score with the approved explicit lexicographic objective: invalidity, appearance imbalance, total repeat excess, maximum pair frequency, worst per-car repeat burden, squared repeat burden, squared pair frequency, consecutive byes, immediate repeat opponents, and stable opponent key.
- Removed every lane metric and lane ordering from opponent candidate comparison. Lane assignment now runs only after the best opponent grouping has been selected.
- Replaced greedy lane placement with deterministic equitable edge-colouring. Appearance incidences are split into degree-three buckets, padded to a 3-regular bipartite multigraph, and decomposed into three deterministic perfect matchings. This guarantees entrant lane spread at most one and also balances the vacant slot in two-car heats.
- Extended `GeneratedSchedule` with the final domain `quality` report so consumers share the same certificate.
- Extended `ScheduleQualityReport` with repeat-excess and maximum-frequency lower bounds and gaps, opponent quality status, worst per-car repeat burden, squared repeat burden, and squared pair frequency.
- Lower bounds use the actual number of pair meetings in the schedule. A three-car heat contributes three pair meetings and a two-car heat contributes one. The repeat lower bound is `max(0, pairMeetings - possiblePairs)` and the maximum-frequency lower bound is the pair-meeting pigeonhole bound.
- Replaced delimiter-joined domain pair keys with canonical JSON pair keys so opaque stable IDs cannot collide.
- Preserved fixed operation budgets and seed determinism; no wall-clock stopping was introduced.

## TDD Evidence

All pnpm commands used the bundled Node runtime by prepending `C:\Users\engah\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin` to `PATH`.

### RED

After tests were changed and before production code was changed:

`pnpm vitest run packages/domain/src/schedule-quality.test.ts packages/scheduler/src/generate.test.ts packages/scheduler/src/generate.property.test.ts`

Exit 1: three test files failed, with 23 failed and 27 passed tests. Expected failures demonstrated all requested gaps: missing full score API and tuple terms, lane spread 2 counterexamples, absent quality certificates, and the `a::b::c` delimiter collision.

### GREEN

The first production pass reduced the result to one outdated pair-key expectation: 49 passed and 1 failed. After correcting that expectation, the combined targeted suite passed 50/50. The property suite was then strengthened with the exhaustive 3-24 entrant by 1-10 match matrix and vacant-lane balance, bringing the final targeted total to 51 tests.

## Fresh Verification

1. Targeted domain and scheduler tests:

   `pnpm vitest run packages/domain/src/schedule-quality.test.ts packages/scheduler/src/generate.test.ts`

   Exit 0: 2 files and 49/49 tests passed.

2. Strengthened property suite:

   `pnpm vitest run packages/scheduler/src/generate.property.test.ts`

   Exit 0: 1 file and 2/2 tests passed, including every supported entrant/match combination.

3. Typecheck:

   `pnpm typecheck`

   Exit 0: `tsc -b --pretty false` completed without errors.

4. Full repository verification:

   `pnpm check`

   Exit 0: typecheck passed, then 11 files and 183/183 tests passed.

5. Diff hygiene:

   `git diff --check`

   Exit 0 with no whitespace errors.

## Required Cases Covered

- Literal full-objective tuple and comparison tests.
- Tied repeat-excess/maximum-frequency distribution with different worst per-car burden.
- Independent squared-burden and squared-pair-frequency ordering.
- Identical opponent groups with different lanes producing the same opponent score.
- No-repeat, forced-repeat, three-entrant, four-triple, seven-entrant Fano-system, two-car, and non-divisible certificate fixtures.
- Collision-safe `analyseSchedule` fixture using `a`, `b::c`, `a::b`, and `c`.
- Byte-identical same-seed serialized output.
- Entrant and vacant-lane spread at most one across the complete supported matrix.

## Concern / Assumption

The published lower bounds are deliberately conservative pigeonhole certificates. A valid schedule that misses one of these bounds remains truthfully labelled `best-found`; the report does not claim stronger design-specific optimality without a proof.
