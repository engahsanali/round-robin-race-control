# Task 3 review fix round 1 report

## Scope

Started from `0ad71b19b8b0610a4d7c896a732fa3c3f711d709`. Changed only the Meet account, hosted repository, store, team shell, associated tests, and this report. Concurrent Task 2.5 migration/test files were preserved and excluded from this commit.

## Test-first evidence

- Added focused regressions before production changes.
- Initial focused run: 32 tests, 14 expected failures and 18 passes.
- The failures covered recovery UI transitions, strict hosted rows, exact winner RPC arguments, thrown command failures, committed/readback advisory handling, selected workspace state, synchronous duplicate protection, realtime filters, and modal focus/inert/Escape behaviour.
- Final focused run: 6 files, 33 tests passed.

## Fixes

- Recovery sessions now keep the authenticated user in the update-password UI, and the panel reacts when `PASSWORD_RECOVERY` arrives after mount.
- Auth supports `INITIAL_SESSION`, accepts HTTP only for exact localhost/127.0.0.1 development hosts, and keeps callback material root-only and scrubbed before exchange.
- Heat confirmation/correction use the committed SQL argument `winner_car_id`.
- RPC/network throws become discriminated state-preserving receipts. Post-commit readback failures remain successful with a do-not-repeat advisory.
- Every public command wrapper has an explicit readback. Member removal no longer retries or loses its committed success when refresh fails.
- Store command execution uses a synchronous pending set and `try/finally`; official UI mutations use the store runner and reuse a stable request ID while pending.
- Store state is initialised from and reset across the selected workspace, organisation, role, sign-out, and demo boundaries; capabilities derive from the server-provided role.
- Hosted meet rows are strictly validated before publication. Current advancement snapshots remain in `MeetStateV1`, while the complete validated replacement history is returned through an explicit history channel.
- Realtime invalidation subscribes with meet/bracket filters and separate organisation filters for access tables; cleanup cancels timers, in-flight reads, and the exact channel.
- The member-removal dialog focuses its reason field, makes its background inert, closes on Escape, and restores focus to the originating control.

## Verification

- `pnpm --filter @rr3/meet test`: 33/33 passed.
- `pnpm --filter @rr3/meet build`: passed.
- `pnpm check`: TypeScript passed; 205/205 root tests passed.
- `pnpm --filter @rr3/pro exec vitest run --environment jsdom --testTimeout=30000 --maxWorkers=1`: 74/74 passed.
- `pnpm --filter @rr3/pro build`: passed.
- `git diff --check -- apps/meet`: passed (line-ending warnings only).
- Scoped secret scan found no credential values. The only sensitive-name match is the intentional rejection test/config guard for privileged environment variable names.

## Deferred external gate

No claim is made that these adapters or policies were executed against a real Supabase project. Docker/project authentication, live RLS execution, production environment configuration, and deployed multi-user verification remain later release gates.
