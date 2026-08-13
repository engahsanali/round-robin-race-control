# Round Robin Shared Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the canonical event schema, exact workbook presets, deterministic custom scheduler, standings/ranking engine, money calculations, and safe import/export contracts used to verify both editions.

**Architecture:** Framework-independent TypeScript packages expose pure functions and versioned JSON-compatible types. Canonical JSON fixtures are the source of truth for workbook schedules, while tests enforce deterministic behavior and cross-edition parity.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest, Zod, fast-check for bounded property tests.

## Global Constraints

- The 9-, 12-, 15-car, and 15-car finals schedules must exactly match the supplied specification.
- The 15-car preliminary template has exactly six matches; there is no empty Match 7.
- Every business entity uses a stable string ID; array positions are never identifiers.
- Money is stored as integer cents.
- Official wins are derived only from completed heats whose winner is assigned to that heat.
- Custom generation is deterministic for identical ordered entrants, settings, and seed.
- Car number is not a competitive tie break unless explicitly configured.
- Imported text is untrusted; import is atomic and rejects prototype-pollution keys.
- No task may weaken the JSON schema compatibility required by both editions.

---

### Task 1: Workspace, canonical fixtures, and event schema

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `fixtures/schedules.json`
- Create: `fixtures/demo-event.json`
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/types.ts`
- Create: `packages/domain/src/schema.ts`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/src/schema.test.ts`

**Interfaces:**
- Produces: `EventStateV1`, `Participant`, `CarEntry`, `Heat`, `Payment`, `AuditEntry`, `SchedulePreset`.
- Produces: `eventStateV1Schema` and `validateEventState(input): ValidationResult<EventStateV1>`.
- Produces: canonical presets keyed `template9`, `template12`, `template15`, and `finals15`.

- [ ] **Step 1: Add the workspace configuration and failing schema tests**

The root scripts are:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty false",
    "check": "pnpm typecheck && pnpm test"
  }
}
```

Tests must assert version 1 acceptance, stable required IDs, duplicate active car-number rejection, unsupported-version rejection, winner-not-in-heat rejection, duplicate-ID rejection across every entity collection, negative/NaN money rejection, and recursive rejection of `__proto__`, `constructor`, and `prototype` keys.

- [ ] **Step 2: Run the targeted test to prove it fails**

Run: `pnpm vitest run packages/domain/src/schema.test.ts`  
Expected: FAIL because the schema module is not implemented.

- [ ] **Step 3: Implement JSON-compatible types and Zod validation**

`EventStateV1` must contain:

```ts
type EventStateV1 = {
  version: 1;
  event: {
    id: string; name: string; date: string; venue: string; organizer: string;
    laneCount: 3; status: "setup" | "running" | "completed";
    createdAt: string; updatedAt: string; resultSeal: "draft" | "provisional" | "official";
  };
  settings: {
    scheduleMode: "template9" | "template12" | "template15" | "custom";
    seed: string; rankingMode: "competition" | "dense" | "ordinal";
    allowSharedRanks: boolean; tieBreakOrder: TieBreakKey[];
    finalistCount: number; autoSave: boolean; confirmWinnerChanges: boolean;
    enableTiming: boolean; prices: Record<string, number>;
  };
  participants: Participant[];
  entries: CarEntry[];
  matches: Heat[];
  finals: Heat[];
  payments: Payment[];
  auditLog: AuditEntry[];
};
```

Normalize user strings by trimming and bounding lengths, but never execute or insert them as markup. Validation returns all actionable issues and never mutates the input.

- [ ] **Step 4: Transcribe all four preset arrays and create a mixed demo event**

`fixtures/schedules.json` contains numeric lane slots exactly as specified in the source prompt. `fixtures/demo-event.json` contains nine clearly labeled sample participants, the exact 9-car preset, mixed completed/incomplete heats, a visible tie, and paid/partial/unpaid examples.

- [ ] **Step 5: Run schema tests and type checking**

Run: `pnpm vitest run packages/domain/src/schema.test.ts && pnpm typecheck`  
Expected: PASS with zero type errors.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts fixtures packages/domain
git commit -m "feat: add canonical race event schema"
```

### Task 2: Fixed schedules and integrity analysis

**Files:**
- Create: `packages/domain/src/presets.ts`
- Create: `packages/domain/src/schedule-quality.ts`
- Test: `packages/domain/src/presets.test.ts`
- Test: `packages/domain/src/schedule-quality.test.ts`

**Interfaces:**
- Consumes: `SchedulePreset`, `Heat`, `CarEntry`.
- Produces: `getPreset(key): SchedulePreset`.
- Produces: `mapPresetToCars(preset, orderedCarIds): Heat[]`.
- Produces: `analyseSchedule(heats, activeCarIds): ScheduleQualityReport`.

- [ ] **Step 1: Write failing exactness and invariant tests**

For every preset assert match count, heat count, three distinct slots per heat, exactly one appearance per car per match, expected total appearances, unique heat IDs, and deep equality with `fixtures/schedules.json`. Assert `template15` has match numbers `[1,2,3,4,5,6]`.

- [ ] **Step 2: Run tests to prove the functions are missing**

Run: `pnpm vitest run packages/domain/src/presets.test.ts packages/domain/src/schedule-quality.test.ts`  
Expected: FAIL because exports are missing.

- [ ] **Step 3: Implement preset mapping and quality metrics**

`ScheduleQualityReport` includes:

```ts
type ScheduleQualityReport = {
  status: "valid" | "valid-with-warnings" | "invalid";
  errors: string[];
  warnings: string[];
  appearances: Record<string, number>;
  laneCounts: Record<string, [number, number, number]>;
  pairCounts: Record<string, number>;
  repeatedOpponentCount: number;
  maximumPairFrequency: number;
  appearanceImbalance: number;
  maximumLaneSpread: number;
  byeCounts: Record<string, number>;
  twoCarHeatCounts: Record<string, number>;
};
```

Pair keys use sorted stable IDs joined with `::`. A heat winner is valid only when it matches one assigned lane. Cancelled heats remain part of schedule-appearance analysis but award no result.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/domain/src/presets.test.ts packages/domain/src/schedule-quality.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/domain/src fixtures/schedules.json
git commit -m "feat: validate exact race schedule presets"
```

### Task 3: Deterministic custom schedule optimizer

**Files:**
- Create: `packages/scheduler/package.json`
- Create: `packages/scheduler/src/prng.ts`
- Create: `packages/scheduler/src/generate.ts`
- Create: `packages/scheduler/src/index.ts`
- Test: `packages/scheduler/src/generate.test.ts`
- Test: `packages/scheduler/src/generate.property.test.ts`

**Interfaces:**
- Consumes: ordered stable car IDs and `CustomScheduleOptions`.
- Produces: `generateCustomSchedule(carIds, options): GeneratedSchedule`.
- Produces: deterministic `seedToUint32(seed)` and `mulberry32(seed)`.

- [ ] **Step 1: Write deterministic and fairness tests**

Tests cover entrant counts 3 through 24, matches 1 through 10, repeat calls with the same seed, changed seed behavior, two-car heats/byes, distinct cars per heat, no duplicate appearance within a match, appearance imbalance at most one where possible, stable IDs, and `analyseSchedule` status never invalid for generated output.

The test also compares the optimizer with a naive sequential grouping baseline and requires its lexicographic score to be no worse for 7, 8, 10, 11, 13, and 16 entrants over five matches.

- [ ] **Step 2: Run targeted tests to prove failure**

Run: `pnpm vitest run packages/scheduler/src/generate.test.ts`  
Expected: FAIL because the generator is missing.

- [ ] **Step 3: Implement seeded construction and bounded local search**

`CustomScheduleOptions` is:

```ts
type CustomScheduleOptions = {
  matches: number;
  seed: string;
  restarts?: number;
  iterationsPerRestart?: number;
};
```

Defaults are 24 restarts and 1,500 iterations per restart, capped so the product of entrants × matches × restarts × iterations remains bounded. Construct match partitions with a deterministic circle/rotation baseline, insert byes when required, rotate lane assignments, then improve through seeded swaps.

Compare candidates lexicographically using:

```ts
[
  invalidHeatCount,
  appearanceImbalance,
  weightedPairRepeatPenalty,
  maximumPairFrequency,
  maximumLaneSpread,
  consecutiveByePenalty,
  immediateRepeatPenalty,
  stableScheduleKey
]
```

`weightedPairRepeatPenalty` adds `count - 1` for the second meeting and `4 * (count - 2)` for third and later meetings. Never use wall-clock time as a stopping condition.

- [ ] **Step 4: Run unit and property tests**

Run: `pnpm vitest run packages/scheduler/src/generate.test.ts packages/scheduler/src/generate.property.test.ts`  
Expected: PASS with deterministic snapshots.

- [ ] **Step 5: Commit**

```powershell
git add packages/scheduler packages/domain/src/schedule-quality.ts
git commit -m "feat: add deterministic fair schedule optimizer"
```

### Task 4: Results, standings, ranking proofs, and finals

**Files:**
- Create: `packages/domain/src/results.ts`
- Create: `packages/domain/src/rankings.ts`
- Create: `packages/domain/src/finals.ts`
- Test: `packages/domain/src/results.test.ts`
- Test: `packages/domain/src/rankings.test.ts`
- Test: `packages/domain/src/finals.test.ts`

**Interfaces:**
- Produces: `recordWinner(state, heatId, carId, correctionReason?)`.
- Produces: `cancelHeat(state, heatId, reason)`, `markRerun(state, heatId, reason)`.
- Produces: `calculateStandings(state, phase): Standing[]`.
- Produces: `calculateRankings(standings, settings): RankedStanding[]`.
- Produces: `explainRank(carId, rankings): RankProof`.
- Produces: `selectFinalists(rankings, count): QualificationDecision`.

- [ ] **Step 1: Write failing result and ranking tests**

Include every scoring/ranking case from the supplied specification: one official win, losing zero, winner replacement, reconfirm idempotence, cancellation removal, rerun replacement, match totals, partial/empty results, inactive exclusion, invalid winner rejection, unknown ID rejection, competition and dense ranks, configured deterministic tie breaks, unresolved visible ties, no podium before results, and tied cutoff handling.

- [ ] **Step 2: Run the tests to prove failure**

Run: `pnpm vitest run packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts`  
Expected: FAIL because the functions are missing.

- [ ] **Step 3: Implement immutable result updates and pure projections**

Every result mutation validates first, returns a new state, appends an audit entry, and preserves the old winner in the audit description. A rerun clears the previous official result before accepting a replacement.

Ranking comparator evaluates the configured keys in order and returns equality when unresolved. Competition/dense rank assignment uses comparator equality, while deterministic UI ordering is stored separately and visibly labeled non-competitive unless car number was configured.

- [ ] **Step 4: Implement finals qualification decisions**

`QualificationDecision` returns automatic qualifiers, tied cutoff entrants, and allowed actions `include-all | playoff | manual-with-reason`. Empty/inactive entries can never qualify.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run packages/domain/src/results.test.ts packages/domain/src/rankings.test.ts packages/domain/src/finals.test.ts`  
Expected: PASS.

```powershell
git add packages/domain/src
git commit -m "feat: add auditable standings and finals engine"
```

### Task 5: Payments, persistence contract, and safe exports

**Files:**
- Create: `packages/domain/src/payments.ts`
- Create: `packages/domain/src/serialization.ts`
- Create: `packages/domain/src/csv.ts`
- Test: `packages/domain/src/payments.test.ts`
- Test: `packages/domain/src/serialization.test.ts`
- Test: `packages/domain/src/csv.test.ts`

**Interfaces:**
- Produces: `calculateParticipantAccount(state, participantId)`.
- Produces: `calculateEventAccounts(state)`.
- Produces: `serializeEvent(state)`, `parseEventJson(text)`, `migrateEvent(input)`.
- Produces: `toCsv(rows)` and report-specific row builders.

- [ ] **Step 1: Write failing payment/import/CSV tests**

Copy all required payment and persistence/import assertions from the supplied specification. Add CRLF/newline, comma, quote, Unicode, and `= + - @` CSV-prefix cases. Assert failed import leaves a separately supplied current state object byte-for-byte unchanged.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm vitest run packages/domain/src/payments.test.ts packages/domain/src/serialization.test.ts packages/domain/src/csv.test.ts`  
Expected: FAIL because functions are missing.

- [ ] **Step 3: Implement integer-cent accounting**

Entry charge is `quantity * categoryPriceCents`. Collected is the signed sum of payments. Balance is charge minus collected; a negative balance is a credit. Reject non-integer cents, invalid quantities, and missing category prices.

- [ ] **Step 4: Implement atomic parse/migration and safe CSV**

CSV cells beginning with optional whitespace followed by `= + - @` receive a leading apostrophe. Quote fields containing comma, quote, CR, or LF and double embedded quotes. `parseEventJson` parses into a temporary value, rejects dangerous keys before schema validation, migrates supported historical versions, and returns `{ok:false, issues}` without touching current state.

- [ ] **Step 5: Run full core verification**

Run: `pnpm check`  
Expected: all tests pass and type checking exits 0.

- [ ] **Step 6: Commit**

```powershell
git add packages/domain/src
git commit -m "feat: add safe event accounting and interchange"
```
