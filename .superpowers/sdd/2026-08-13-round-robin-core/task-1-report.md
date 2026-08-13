# Task 1 Report

## Status

DONE

Implemented the pnpm/TypeScript/Vitest workspace foundation, canonical schedule fixtures, mixed demo event, JSON-compatible event-domain types, Zod schema, non-mutating validation result API, and schema contract tests.

## Commits

- `ffa658ce33d713791aedc21392e1182280f3a307` — `feat: add canonical race event schema`
- The report itself is committed separately after this file is created; the parent task response records that administrative commit SHA.

## Files

- `.gitignore` — ignores TypeScript build-info output.
- `package.json` — required root scripts and pinned workspace tooling.
- `pnpm-lock.yaml` — reproducible dependency graph.
- `pnpm-workspace.yaml` — package globs and explicit `esbuild` build approval.
- `tsconfig.base.json` — strict shared TypeScript configuration.
- `tsconfig.json` — root build entrypoint used by the required `tsc -b` script.
- `vitest.config.ts` — Node-based package test discovery.
- `fixtures/schedules.json` — exact `template9`, `template12`, `template15`, and `finals15` numeric arrays from the amended authoritative brief.
- `fixtures/demo-event.json` — nine labeled participants, exact template9 heat mapping, six completed and six incomplete heats, a two-win tie, and paid/partial/unpaid examples.
- `packages/domain/package.json` — shared domain package manifest.
- `packages/domain/src/types.ts` — `EventStateV1`, entity types, preset types, JSON types, and validation result contract.
- `packages/domain/src/schema.ts` — Zod schema, cross-entity integrity checks, string normalization, dangerous-key scan, and `validateEventState`.
- `packages/domain/src/index.ts` — public exports and four keyed canonical presets.
- `packages/domain/src/schema.test.ts` — 22 behavior tests for the required acceptance and rejection cases.

## Test commands and exact outcomes

1. RED: `pnpm vitest run packages/domain/src/schema.test.ts`
   - Initial bundled-pnpm dependency status check exited 1 with `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2` before Vitest started.
   - After explicitly approving `esbuild` and prepending the bundled Node directory to `PATH`, the required targeted command exited 1 as expected: one failed suite, no tests collected, `Cannot find module './schema'`.
2. Dependency recovery: `pnpm approve-builds esbuild` then, with bundled Node on `PATH`, `pnpm rebuild esbuild`
   - `esbuild@0.28.2` postinstall completed. `pnpm-workspace.yaml` now records the explicit build approval.
3. GREEN after schema implementation: `pnpm vitest run packages/domain/src/schema.test.ts`
   - Exit 0: 1 test file passed; 20 tests passed.
4. Fixture RED after adding fixture contract tests: `pnpm vitest run packages/domain/src/schema.test.ts`
   - Exit 1 as expected: one failed suite, no tests collected, `Cannot find module '../../../fixtures/demo-event.json'`.
5. Required combined verification: `pnpm vitest run packages/domain/src/schema.test.ts && pnpm typecheck`
   - Exit 0: 1 test file passed; 22 tests passed; `tsc -b --pretty false` completed with zero type errors.
6. Independent fixture integrity check: bundled `node -e` comparison and schedule invariant script.
   - Exit 0: `fixture-integrity: 4 presets valid; demo matches template9 exactly`.
7. Final full suite: `pnpm test`
   - Exit 0: 1 test file passed; 22 tests passed.
8. Diff hygiene: `git diff --check` before staging and `git diff --cached --check` before commit.
   - Both exited 0; only Windows LF-to-CRLF working-copy notices were emitted by Git during staging.

## Self-review

- Re-read the amended brief and checked every Task 1 interface and acceptance condition against the implementation.
- Confirmed all business collections require non-empty stable string IDs; duplicate IDs are rejected in participants, entries, preliminary heats, finals heats, payments, and audit entries, including a heat ID collision across preliminary/final collections.
- Confirmed duplicate car numbers are rejected only when both entries are active, preserving inactive historical entries.
- Confirmed only version 1 is accepted and heat winners must be assigned to the completed heat.
- Confirmed category prices, payment cents, durations, car numbers, quantities, match numbers, and heat numbers reject impossible numeric values appropriate to their domains.
- Confirmed recursive own-key scanning rejects `__proto__`, `constructor`, and `prototype` before a validation success can be returned.
- Confirmed Zod parsing returns normalized cloned data and the test proves the original input remains byte-for-byte structurally unchanged.
- Confirmed string fields are trimmed and bounded; values are data only and no rendering/execution API exists in the domain package.
- Confirmed all four fixture match counts and per-match entrant coverage; template15 has exactly six matches and no empty Match 7.
- Confirmed the demo contains the exact template9 lane order, an explicit visible tie, and payment examples representing paid, partial, and unpaid accounts.
- Mutation review: removing version literal enforcement, ID minimums, duplicate checks, winner membership, finite/nonnegative money rules, recursive dangerous-key scanning, normalization, or any fixture endpoint/count would fail at least one focused test.

## Concerns

None outstanding. The bundled runtime requires its Node `bin` directory on `PATH`; the repository records the required `esbuild` build approval so pnpm's dependency status check is no longer blocked.
