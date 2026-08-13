# Pro Task 4 implementation and review-fix report

## Review fix round 1 — harden Schedule Lab gates

Date: 2026-08-14
Base: `5926d57`

### TDD evidence

- RED: `pnpm --filter @rr3/pro test -- ScheduleLabPage.test.tsx`
  - Exit 1 with exactly three new regressions failing while the existing 50 Pro tests passed.
  - A valid 25-active-car event exposed an enabled custom-generation action and no explanatory gate.
  - A ten-car warning-bearing generated schedule was labeled `Certified optimal` even though its certificate reported bye warnings.
  - Opening schedule activation left focus on the background trigger and did not make the Schedule Lab background inert.
- GREEN: the same focused command passed 6 files and 53/53 tests, including all six Schedule Lab behaviors.

### Changes

- Custom generation is disabled outside the shared scheduler's supported 3–24 active-car range, with an accessible exact-count explanation. The generator is never called for an unsupported count.
- Quality certificate precedence now reports `Invalid`, then `Valid with warnings`, then opponent optimal/best-found status. Warning-bearing schedules cannot claim `Certified optimal`; bound and gap metrics remain visible.
- Schedule activation now initial-focuses the confirm action, marks the background inert, cancels on Escape, returns focus to its unchanged trigger after cancel, and moves focus to the activation status after a committed replacement.
- Component and Chromium E2E tests protect the gate, status truthfulness, modal focus lifecycle, and inert background.

### Verification

- Focused Pro command: `pnpm --filter @rr3/pro test -- ScheduleLabPage.test.tsx` — 6 files, 53/53 tests passed.
- Chromium Schedule Lab E2E: `pnpm playwright test tests/e2e/pro-schedule-lab.spec.ts --project=chromium` — 1/1 passed.
- Pro production build: `pnpm --filter @rr3/pro build` — TypeScript and Vite/PWA passed; 1,082 modules transformed and 12 precache entries generated.
- Root gate: `pnpm check` — typecheck passed; 11 files and 183/183 shared domain/scheduler tests passed.
- Bounded Solo shell regression: `pnpm playwright test tests/e2e/solo-shell.spec.ts --project=chromium` — 9/9 passed.
- `git diff --check` passed.

### Concerns

None known within the three reviewed Task 4 gaps. No Task 5 functionality or Solo production file was changed.

## Review fix round 2 — scope schedule certificates

Date: 2026-08-14

### TDD evidence

- RED: `pnpm --filter @rr3/pro test -- ScheduleLabPage.test.tsx`
  - Exit 1. A new real `analyseSchedule` fixture produced `status: valid`, `repeatExcessGap: 0`, and `maximumPairFrequencyGap: 2`; the UI still exposed a global `Certified optimal` heading and no independently rendered objective certificates.
  - The loaded full-suite RED run also had one pre-existing custom-generation test cross Vitest's five-second default; the isolated GREEN and later full Pro run passed it without changing its behavior or timeout.
- GREEN: `pnpm --filter @rr3/pro exec vitest run --environment jsdom src/features/schedule/ScheduleLabPage.test.tsx` — 1 file and 7/7 tests passed.

### Changes

- The global quality heading now reports only structural validity: `Invalid`, `Valid with warnings`, or `Valid`.
- Repeat excess and maximum pair frequency each report their own lower-bound certificate. A zero objective gap says `Certified optimal`; a positive gap says `Best found`, alongside actual, lower bound, and exact gap values. Invalid schedules say `Not certified` for both objectives.
- The mixed-gap fixture proves repeat excess can be certified while maximum pair frequency remains best found, without a misleading global optimality claim.

### Verification

- Focused Schedule Lab: 7/7 passed.
- Full Pro: `pnpm --filter @rr3/pro test` — 6 files and 54/54 tests passed.
- Chromium Schedule Lab E2E: 1/1 passed.
- Pro build: TypeScript and Vite/PWA passed; 1,082 modules transformed and 12 precache entries generated.
- Root gate: `pnpm check` — 11 files and 183/183 shared tests passed.
- Solo shell Chromium: 9/9 passed.

### Concerns

None known within this certificate-labeling fix. No Task 5 or Solo production code changed.
