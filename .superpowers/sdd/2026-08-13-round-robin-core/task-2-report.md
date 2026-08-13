# Task 2 Report: Fixed Schedules and Integrity Analysis

## Status

Complete.

## Commits

- `9321048 feat: validate exact race schedule presets`

## Files

- `packages/domain/src/types.ts` — added `ScheduleQualityReport`.
- `packages/domain/src/presets.ts` — canonical preset lookup and stable-ID heat mapping.
- `packages/domain/src/schedule-quality.ts` — schedule structural validation and fairness metrics.
- `packages/domain/src/index.ts` — exported the new public domain APIs.
- `packages/domain/src/presets.test.ts` — fixture exactness, counts, lane, ID, appearance, and template-15 coverage.
- `packages/domain/src/schedule-quality.test.ts` — structural validation, cancelled heat, bye/two-car, and pair-key coverage.

## Test Commands and Exact Outcomes

The shell initially could not resolve `node`; after prepending the bundled runtime directory to `PATH`, all checks ran successfully.

```powershell
$env:PATH='C:\Users\engah\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;'+$env:PATH
pnpm vitest run packages/domain/src/presets.test.ts packages/domain/src/schedule-quality.test.ts
```

Outcome: `2 passed`, `19 passed`.

```powershell
pnpm typecheck
```

Outcome: exit code `0` (`tsc -b --pretty false`).

```powershell
pnpm test
```

Outcome: `3 passed`, `48 passed`.

```powershell
git diff --check
```

Outcome: exit code `0`.

## Self-review

- `getPreset` returns a cloned preset so caller mutation cannot alter its next lookup.
- Mapping validates exact ordered-car count, non-empty IDs, and uniqueness; generated heat IDs include preset, match, and heat identifiers.
- Quality analysis derives pair keys from sorted stable IDs, includes cancelled heats in schedule metrics, and flags duplicate IDs, duplicate lanes, unknown active cars, and invalid winners.
- Tests independently assert literal match and heat totals, every fixed schedule's fixture equality, and the six-match 15-car preliminary sequence.

## Concerns

None. The ambient shell still requires the bundled Node directory to be prepended before pnpm commands; this was applied only to the verification process.

## Review Follow-up (Round 1/5)

### Status

Complete. Addressed all reviewer findings with focused regression coverage.

### Changes

- Rejects an active car assigned to multiple heats within the same phase/match.
- Counts a bye once per match when an active car has no heat in that match.
- Defines `repeatedOpponentCount` as repeat excess: `sum(max(0, frequency - 1))`.
- Rejects non-integer and out-of-range preset slots before car-ID mapping.
- Publishes a deep-frozen schedule-preset snapshot; `getPreset` continues to return a mutable clone.

### Verification

```powershell
$env:PATH='C:\Users\engah\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;'+$env:PATH
pnpm vitest run packages/domain/src/presets.test.ts packages/domain/src/schedule-quality.test.ts
```

Outcome: `2 passed`, `26 passed`.

```powershell
pnpm typecheck
```

Outcome: exit code `0` (`tsc -b --pretty false`).

### Self-review

- Focused tests fail against the previous implementation for all four findings and pass after the minimal changes.
- Match identity includes phase plus match number, avoiding a false duplicate or bye interaction if preliminary and final heats are analysed together.
- Frozen public presets cannot mutate the internal canonical source, and each `getPreset` call remains isolated.
