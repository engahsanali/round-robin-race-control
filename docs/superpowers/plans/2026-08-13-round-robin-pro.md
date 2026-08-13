# Round Robin Pro Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable, local-first React race-control application with premium live operations, analytics, schedule comparison, spectator mode, recovery history, and cross-edition compatibility.

**Architecture:** A Vite React shell imports pure domain/scheduler workspace packages. Feature folders own UI and adapters. Event commands write transactionally to Dexie and broadcast committed snapshots to same-origin spectator tabs. Recharts and Motion provide accessible explanatory visualization and restrained transitions.

**Tech Stack:** React, TypeScript, Vite, Dexie, Recharts, Motion, vite-plugin-pwa, Vitest, Testing Library, Playwright.

## Global Constraints

- Pro must implement every official rule and interchange contract in the shared core design.
- Pro must display `Made by Cesar Lacsamana and Ahsan Ali`.
- No backend, account, tracking, or claim of cross-device live synchronization.
- Same-origin tab synchronization is read-only for spectator views and clearly labeled.
- IndexedDB writes are transactional; destructive migrations require an export/recovery path.
- Service-worker updates use prompt behavior and never force-reload an active event.
- Charts supplement semantic tables and written takeaways.
- Motion honors the user's reduced-motion preference.
- Mobile and keyboard users can perform every official action without dragging, swiping, or long-pressing.

---

### Task 1: Pro scaffold, PWA shell, tokens, and routing

**Files:**
- Create: `apps/pro/package.json`
- Create: `apps/pro/index.html`
- Create: `apps/pro/vite.config.ts`
- Create: `apps/pro/tsconfig.json`
- Create: `apps/pro/netlify.toml`
- Create: `apps/pro/public/manifest.webmanifest`
- Create: `apps/pro/src/main.tsx`
- Create: `apps/pro/src/app/App.tsx`
- Create: `apps/pro/src/app/routes.tsx`
- Create: `apps/pro/src/styles/tokens.css`
- Create: `apps/pro/src/styles/global.css`
- Test: `apps/pro/src/app/App.test.tsx`

**Interfaces:**
- Produces routes `/`, `/registration`, `/schedule`, `/race`, `/standings`, `/finals`, `/reports`, `/settings`, `/diagnostics`, `/present`.

- [ ] **Step 1: Write failing shell tests**

Test product mark, creator credit, semantic landmarks, nine operator destinations, presentation route, system/light/dark themes, reduced-motion configuration, skip link, live regions, and PWA update prompt mount.

- [ ] **Step 2: Run the test to prove failure**

Run: `pnpm --filter @rr3/pro test -- App.test.tsx`  
Expected: FAIL because the app does not exist.

- [ ] **Step 3: Scaffold the Vite application and accessible shell**

Use a command-center layout with status rail, responsive navigation, main outlet, recovery indicator, command palette trigger, footer credit, and native dialog surfaces. Use route-level lazy loading only where it improves initial load without obscuring live-race reliability.

- [ ] **Step 4: Configure prompt-update PWA behavior**

Precache shell assets, display an explicit “Update ready” action, and defer reload while an official result form is dirty or a race is running. Manifest name is “Round Robin Race Control Pro,” short name “RR·3 Pro,” with standalone display and graphite/cyan theme.

- [ ] **Step 5: Run tests/build and commit**

Run: `pnpm --filter @rr3/pro test && pnpm --filter @rr3/pro build`  
Expected: PASS and `apps/pro/dist/index.html` exists.

```powershell
git add apps/pro
git commit -m "feat: scaffold pro race control pwa"
```

### Task 2: Transactional event store, migrations, history, and interchange

**Files:**
- Create: `apps/pro/src/persistence/db.ts`
- Create: `apps/pro/src/persistence/repository.ts`
- Create: `apps/pro/src/persistence/migrations.ts`
- Create: `apps/pro/src/state/EventProvider.tsx`
- Create: `apps/pro/src/state/commands.ts`
- Test: `apps/pro/src/persistence/repository.test.ts`
- Test: `apps/pro/src/state/commands.test.tsx`

**Interfaces:**
- Produces: `EventRepository.load/save/restore/listSnapshots/exportBeforeMigration`.
- Produces: `useEventState()` and `dispatchEventCommand(command)`.
- Consumes shared core result, registration, payment, schedule, and import functions.

- [ ] **Step 1: Write failing persistence/command tests**

Cover fresh boot, schema migration, atomic save, bounded 50-snapshot history, restore, storage-persistence status, Solo JSON import, compatible export, invalid import preservation, and commands for every official mutation with an audit/result receipt.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm --filter @rr3/pro test -- repository.test.ts commands.test.tsx`  
Expected: FAIL because repository/provider are missing.

- [ ] **Step 3: Implement Dexie tables and repository transactions**

Tables store one live event, ordered revisions, and preferences. A committed command validates a candidate state, saves live + revision in one transaction, trims revisions beyond 50, then publishes state to React. Request `navigator.storage.persist()` only after user interaction and show granted/denied/unavailable explicitly.

- [ ] **Step 4: Implement command receipts and guarded migrations**

`dispatchEventCommand` returns:

```ts
type CommandReceipt = {
  commandId: string;
  timestamp: string;
  summary: string;
  affectedCarIds: string[];
  previousRanks: Record<string, number | null>;
  nextRanks: Record<string, number | null>;
  undoUntil: string | null;
};
```

Every migration first creates a downloadable recovery blob through an explicit user flow when the version change is destructive.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @rr3/pro test -- repository.test.ts commands.test.tsx`  
Expected: PASS.

```powershell
git add apps/pro/src/persistence apps/pro/src/state
git commit -m "feat: add transactional pro event history"
```

### Task 3: Dashboard, guided setup, registration, and payments

**Files:**
- Create: `apps/pro/src/features/dashboard/DashboardPage.tsx`
- Create: `apps/pro/src/features/setup/SetupWizard.tsx`
- Create: `apps/pro/src/features/registration/RegistrationPage.tsx`
- Create: `apps/pro/src/features/registration/ParticipantEditor.tsx`
- Create: `apps/pro/src/features/payments/AccountPanel.tsx`
- Create: `apps/pro/src/features/shared/RecoveryPanel.tsx`
- Test: `apps/pro/src/features/setup/SetupWizard.test.tsx`
- Test: `apps/pro/src/features/registration/RegistrationPage.test.tsx`

**Interfaces:**
- Consumes event commands and account/standing projections.
- Produces full event creation, entrant/category/payment management, and recovery status.

- [ ] **Step 1: Write failing behavior tests**

Test the five-step wizard, specific validation, multiple cars, duplicate blocking, withdraw/restore, search/filter/sort, account totals, partial/full/credit/refund states, demo/rehearsal isolation, and recovery-confidence messaging.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm --filter @rr3/pro test -- SetupWizard.test.tsx RegistrationPage.test.tsx`  
Expected: FAIL because feature components are missing.

- [ ] **Step 3: Implement operator-first screens**

Dashboard uses meaningful current/next heat and financial/competition facts, not generic cards. Registration uses an accessible table at wide widths and cards on mobile, while preserving DOM order and all action labels. Every destructive action shows scheduled-race impact.

- [ ] **Step 4: Add dashboard charts and micro-motion**

Use Recharts for completion, payments, category mix, and win gap only after results exist. Add written summaries and accessible tables. Use Motion with `MotionConfig reducedMotion="user"`, 180–240ms state transitions, and persistent text deltas.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @rr3/pro test -- SetupWizard.test.tsx RegistrationPage.test.tsx`  
Expected: PASS.

```powershell
git add apps/pro/src/features
git commit -m "feat: add pro setup registration and dashboard"
```

### Task 4: Schedule Lab and fairness visualizations

**Files:**
- Create: `apps/pro/src/features/schedule/ScheduleLabPage.tsx`
- Create: `apps/pro/src/features/schedule/CandidateComparison.tsx`
- Create: `apps/pro/src/features/schedule/PairMatrix.tsx`
- Create: `apps/pro/src/features/schedule/OpponentNetwork.tsx`
- Create: `apps/pro/src/features/schedule/LaneBalanceChart.tsx`
- Test: `apps/pro/src/features/schedule/ScheduleLabPage.test.tsx`
- Test: `tests/e2e/pro-schedule-lab.spec.ts`

**Interfaces:**
- Consumes preset/custom scheduler and `ScheduleQualityReport`.
- Produces candidate generation/comparison, manual slot mapping, activation, and explainable quality.

- [ ] **Step 1: Write failing schedule-lab tests**

Test exact presets, active count gates, seed determinism, candidate comparison, lower-bound/gap labels, heat integrity, appearance/lane/bye/repeat metrics, pair matrix text alternative, activation only when valid, and viewport behavior.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm --filter @rr3/pro test -- ScheduleLabPage.test.tsx && pnpm playwright test tests/e2e/pro-schedule-lab.spec.ts --project=chromium`  
Expected: FAIL because Schedule Lab is missing.

- [ ] **Step 3: Implement candidate comparison and integrity gating**

Generate at least three deterministic candidates by explicit seeds, show lexicographic comparison without collapsing it into a misleading vanity score, and preserve the selected candidate as immutable until the user deliberately regenerates or activates it.

- [ ] **Step 4: Implement the fairness inspector**

Pair matrix and network show repeat frequency, with filters and a semantic table. Lane chart shows lane counts/spread. Summary language distinguishes certified optimal, valid best-found with gap, valid with warnings, and invalid.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @rr3/pro test -- ScheduleLabPage.test.tsx && pnpm playwright test tests/e2e/pro-schedule-lab.spec.ts --project=chromium`  
Expected: PASS.

```powershell
git add apps/pro/src/features/schedule tests/e2e/pro-schedule-lab.spec.ts
git commit -m "feat: add visual schedule fairness lab"
```

### Task 5: Race Command Center, spectator board, and announcer

**Files:**
- Create: `apps/pro/src/features/race/RaceCommandPage.tsx`
- Create: `apps/pro/src/features/race/HeatStage.tsx`
- Create: `apps/pro/src/features/race/ResultReceipt.tsx`
- Create: `apps/pro/src/features/presentation/PresentationPage.tsx`
- Create: `apps/pro/src/features/presentation/eventChannel.ts`
- Create: `apps/pro/src/features/race/useWakeLock.ts`
- Create: `apps/pro/src/features/race/useAnnouncer.ts`
- Test: `apps/pro/src/features/race/RaceCommandPage.test.tsx`
- Test: `tests/e2e/pro-live-spectator.spec.ts`

**Interfaces:**
- Produces live operations, same-origin BroadcastChannel spectator snapshots, wake-lock toggle, factual optional speech.

- [ ] **Step 1: Write failing live/spectator tests**

Test lane-only winner selection, keyboard flow, status/rerun/cancel/time, auto advance, change reason, atomic receipt, undo, issue queue, previous/next, wake lock reacquisition, speech opt-in/off, spectator read-only sync, “same browser” label, presentation rotation pause/next/previous/interval, and no focus theft.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm --filter @rr3/pro test -- RaceCommandPage.test.tsx && pnpm playwright test tests/e2e/pro-live-spectator.spec.ts --project=chromium`  
Expected: FAIL because command center/presentation are missing.

- [ ] **Step 3: Implement command-center operations**

Build a dense operator cockpit with status rail, current heat, ready/called/delayed/held queue, lane cards, result dock, standing pulse, validation drawer, result receipt, and issue recovery. Disable duplicate submissions while a command transaction is pending.

- [ ] **Step 4: Implement spectator/presentation channel**

Broadcast only validated sanitized snapshots after committed commands. Presentation never writes official state. It shows Live/Provisional/Official, current/next/latest, standings, notices, updated time, and visible rotation controls.

- [ ] **Step 5: Add opt-in wake lock and announcer**

Wake lock has visible state, handles denial, releases on disable, and reacquires after visibility return when previously enabled. Speech reads only deterministic event facts and never blocks result entry.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @rr3/pro test -- RaceCommandPage.test.tsx && pnpm playwright test tests/e2e/pro-live-spectator.spec.ts --project=chromium`  
Expected: PASS.

```powershell
git add apps/pro/src/features tests/e2e/pro-live-spectator.spec.ts
git commit -m "feat: add pro command center and spectator board"
```

### Task 6: Standings Insight Studio, finals, what-if, reports, and recovery

**Files:**
- Create: `apps/pro/src/features/standings/StandingsPage.tsx`
- Create: `apps/pro/src/features/standings/RankProofDrawer.tsx`
- Create: `apps/pro/src/features/insights/InsightStudio.tsx`
- Create: `apps/pro/src/features/insights/WhatIfSandbox.tsx`
- Create: `apps/pro/src/features/finals/FinalsPage.tsx`
- Create: `apps/pro/src/features/reports/ReportsPage.tsx`
- Create: `apps/pro/src/features/history/ReplayTimeline.tsx`
- Test: `apps/pro/src/features/standings/StandingsPage.test.tsx`
- Test: `apps/pro/src/features/insights/WhatIfSandbox.test.tsx`
- Test: `tests/e2e/pro-finals-reports.spec.ts`

**Interfaces:**
- Produces authoritative standings, proof, provisional simulations, finals, Event Pack exports, snapshot replay.

- [ ] **Step 1: Write failing analytics/finals/recovery tests**

Cover every ranking mode/tie case, direct proof, rank bump chart, cumulative wins, head-to-head, consistency, provisional labels, simulation non-mutation, finals cutoff decisions, playoff/manual reason, official champion seal, event pack contents, snapshot restore preview/confirmation, and cross-edition import/export.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm --filter @rr3/pro test -- StandingsPage.test.tsx WhatIfSandbox.test.tsx && pnpm playwright test tests/e2e/pro-finals-reports.spec.ts --project=chromium`  
Expected: FAIL because features are missing.

- [ ] **Step 3: Implement standings proof and analytics**

The semantic table is authoritative. Insight Studio adds lollipop gap, bump history, cumulative match wins, win distribution, lane balance, opponent matrix, and cutoff band, each with a takeaway and accessible data.

- [ ] **Step 4: Implement pure what-if simulation and finals**

Clone state, apply hypothetical official result commands to the clone only, mark every output “What-if — not official,” and provide reset. Finals follows core qualification decisions and cannot publish champion before official sealing.

- [ ] **Step 5: Implement Event Pack and Replay Timeline**

Event Pack downloads JSON plus participant, account, schedule/result, standings, and audit CSV files and a text summary. Replay shows revision timestamp/action and previews rank/heat changes before guarded restore.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm --filter @rr3/pro test -- StandingsPage.test.tsx WhatIfSandbox.test.tsx && pnpm playwright test tests/e2e/pro-finals-reports.spec.ts --project=chromium`  
Expected: PASS.

```powershell
git add apps/pro/src/features tests/e2e/pro-finals-reports.spec.ts
git commit -m "feat: add pro insights finals and recovery"
```

### Task 7: Full Pro accessibility, offline, and production gate

**Files:**
- Create: `tests/e2e/pro-navigation.spec.ts`
- Create: `tests/e2e/pro-accessibility.spec.ts`
- Create: `tests/e2e/pro-offline.spec.ts`
- Create: `scripts/verify-pro-build.mjs`
- Modify: `apps/pro/src/app/App.tsx`
- Modify: `apps/pro/vite.config.ts`

**Interfaces:**
- Produces final build verifier and full user-journey proof.

- [ ] **Step 1: Write failing full-story tests**

Run a complete demo and a clean event through registration, scheduling, racing, standings, finals, export/import, presentation, and history. Test 320px/mobile/tablet/desktop/projector widths; keyboard and focus; reduced motion; long names; empty/error states; PWA first load, offline relaunch, and prompt update.

- [ ] **Step 2: Run tests to expose gaps**

Run: `pnpm playwright test tests/e2e/pro-*.spec.ts`  
Expected: any remaining gaps fail with specific evidence.

- [ ] **Step 3: Fix only proven gaps and complete metadata**

Ensure final title/description, manifest, icons made from CSS/Canvas-generated brand mark rather than remote assets, Open Graph text metadata, and no starter markers. Do not add claims of public live cloud sync.

- [ ] **Step 4: Implement build verifier**

Require expected routes/assets, service worker/manifest, creator credit in compiled content, no source maps or secrets in production output, valid Netlify redirects/headers, and an exact release version.

- [ ] **Step 5: Run the full Pro gate**

Run: `pnpm --filter @rr3/pro test && pnpm --filter @rr3/pro build && node scripts/verify-pro-build.mjs && pnpm playwright test tests/e2e/pro-*.spec.ts`  
Expected: all unit/component/E2E tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/pro tests/e2e scripts/verify-pro-build.mjs
git commit -m "test: verify production pro edition"
```
