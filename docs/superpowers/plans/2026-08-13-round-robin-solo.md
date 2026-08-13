# Round Robin Solo Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one polished, accessible, dependency-free `single-file/index.html` that runs offline and implements the complete workbook-replacement workflow.

**Architecture:** One semantic HTML document contains CSS, versioned fixtures, pure domain functions, state, rendering, event delegation, persistence, import/export, charts, dialogs, help, and an isolated self-test harness. Repository tests execute the file in a browser and compare its embedded schedule data and calculations to canonical fixtures.

**Tech Stack:** HTML5, CSS3, modern strict-mode vanilla JavaScript, inline SVG/Canvas charts, Playwright for external verification.

## Global Constraints

- The final runtime artifact is exactly `single-file/index.html`; it needs no companion file, build step, network, module import, external font, external image, CDN, or backend.
- It must work when opened through both `file://` and HTTPS.
- It must display `Made by Cesar Lacsamana and Ahsan Ali`.
- It must include all nine required views and all exact schedules from the approved design.
- No `eval`, `Function`, `document.write`, or inline event-handler attributes.
- User/imported text must enter the DOM through `textContent`, safe form values, or explicitly escaped attributes.
- Motion must respect `prefers-reduced-motion`; charts need text takeaways and data tables.
- Every result, score, rank, fee, and balance is derived from canonical state, not a second manually incremented counter.

---

### Task 1: Semantic shell, visual system, and first-load state

**Files:**
- Create: `single-file/index.html`
- Create: `single-file/netlify.toml`
- Test: `tests/e2e/solo-shell.spec.ts`

**Interfaces:**
- Produces: `window.RR3` read-only diagnostic/test API with `getState()`, `runAllTests()`, and `version`.
- Produces: views keyed `dashboard registration setup live standings finals reports settings diagnostics`.

- [ ] **Step 1: Write failing browser shell tests**

Assert one HTML file exists; opening it from a local file shows the product mark, exact creator credit, empty real event, “Load Demo Event,” nine navigation targets, light/dark/system theme, live region, and no page/console error. Parse the document and reject external runtime `script[src]`, `link[rel=stylesheet]`, remote images/fonts, unsafe inline handlers, and forbidden JavaScript APIs.

- [ ] **Step 2: Run the test to prove failure**

Run: `pnpm playwright test tests/e2e/solo-shell.spec.ts --project=chromium`  
Expected: FAIL because `single-file/index.html` does not exist.

- [ ] **Step 3: Build the accessible application shell**

Use a skip link, `header`, product mark, event status strip, `nav` with real buttons, one `main`, `footer`, polite save/result status, assertive error status, native `dialog`, and hidden file input. Use event delegation on `data-action` and `data-view`.

The theme variables include graphite surfaces, electric cyan, signal lime, warnings, errors, focus, podium metals, spacing, radii, shadows, and typography. Race-critical controls have a minimum 48px block size. At 320px the nav becomes horizontally scrollable and live controls become a bottom dock.

- [ ] **Step 4: Implement default state and safe rendering primitives**

Embed canonical preset JSON in `<script type="application/json" id="preset-data">`. Define strict-mode pure helpers, `createDefaultState()`, safe DOM element builders, deterministic stable IDs using `crypto.randomUUID()` with a collision-checked fallback, and top-level sanitized error capture.

- [ ] **Step 5: Run shell tests**

Run: `pnpm playwright test tests/e2e/solo-shell.spec.ts --project=chromium`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add single-file tests/e2e/solo-shell.spec.ts
git commit -m "feat: build solo race control shell"
```

### Task 2: Event wizard, registration, fees, and persistence

**Files:**
- Modify: `single-file/index.html`
- Test: `tests/e2e/solo-registration.spec.ts`
- Test: `tests/e2e/solo-persistence.spec.ts`

**Interfaces:**
- Produces UI actions for participant, car, category, price, payment, withdraw/restore, demo load/reset, event setup, backup/restore, and filters.

- [ ] **Step 1: Write failing operator-flow tests**

Tests create an event, add one participant with multiple cars, reject duplicate/invalid active numbers, add partial/full/negative/over-payments, edit prices, filter outstanding accounts, withdraw/restore a car, sort without ID drift, reload through HTTPS storage, export/import JSON, fail an invalid import atomically, and show a file-URL backup warning.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm playwright test tests/e2e/solo-registration.spec.ts tests/e2e/solo-persistence.spec.ts --project=chromium`  
Expected: FAIL because forms/workflows are absent.

- [ ] **Step 3: Implement the guided wizard and registration tables**

Wizard steps are Event, Categories & Prices, Participants, Race Format, and Review & Arm. Use native labeled fields and inline error containers linked by `aria-describedby`. Registration supports participant contact/notes, multiple cars, quantity, category, fee, payments, status, and precise edit/delete warnings for scheduled cars.

- [ ] **Step 4: Implement accounting and persistence**

Calculate cents only. Debounce storage but synchronously save before unload where allowed. Maintain current and previous valid keys, last-saved time, restore previous save, recovery confidence labels, guarded reset, and explicit JSON backup prompt after meaningful file-URL changes.

- [ ] **Step 5: Implement atomic JSON/CSV interchange**

Import into a temporary normalized value and replace state only after every validation passes. Exports cover participant, fee/balance, schedule/result, standings, and audit CSV with formula-prefix sanitization.

- [ ] **Step 6: Run flows and commit**

Run: `pnpm playwright test tests/e2e/solo-registration.spec.ts tests/e2e/solo-persistence.spec.ts --project=chromium`  
Expected: PASS.

```powershell
git add single-file/index.html tests/e2e
git commit -m "feat: add solo event registration and recovery"
```

### Task 3: Schedule setup, custom optimizer, and live racing

**Files:**
- Modify: `single-file/index.html`
- Test: `tests/e2e/solo-scheduling.spec.ts`
- Test: `tests/e2e/solo-live.spec.ts`

**Interfaces:**
- Produces preset mapping preview, deterministic custom generation, fairness report, activation, live heat navigation, winner confirmation/change/cancel/rerun, timing, undo, and result receipts.

- [ ] **Step 1: Write failing scheduling/live tests**

Assert exact preset parity with `fixtures/schedules.json`; required active-car counts; manual slot mapping; full fairness report; deterministic custom output; no invalid generated heat; minimal/best-found repeat status; lane spread; 1/2/3 + Enter winner flow; invalid winner rejection; automatic advance; change confirmation; cancellation/rerun semantics; times; U/Ctrl+Z undo; and audit/result receipt.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm playwright test tests/e2e/solo-scheduling.spec.ts tests/e2e/solo-live.spec.ts --project=chromium`  
Expected: FAIL because scheduling/live views are incomplete.

- [ ] **Step 3: Implement preset and custom schedule flows**

Embed the verified scheduler as pure strict-mode functions. The user selects seed and match count, compares quality, sees lower-bound gap, regenerates deterministically, and cannot activate invalid output.

- [ ] **Step 4: Implement the race cockpit**

Show event, current match/heat, progress, three lane cards, optional time fields, large selectable winner controls, previous result, next heat, compact standings, issue/status controls, shortcut help, and sticky confirmation dock. Result changes never double count and create human-readable audit entries without contact details.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm playwright test tests/e2e/solo-scheduling.spec.ts tests/e2e/solo-live.spec.ts --project=chromium`  
Expected: PASS.

```powershell
git add single-file/index.html tests/e2e
git commit -m "feat: add fair scheduling and live race control"
```

### Task 4: Standings, charts, finals, reports, and delight

**Files:**
- Modify: `single-file/index.html`
- Test: `tests/e2e/solo-standings.spec.ts`
- Test: `tests/e2e/solo-finals-reports.spec.ts`

**Interfaces:**
- Produces dashboard facts, ranking modes, proof drawer, podium, finals, provisional/official seal, charts, print routes, and share/download card.

- [ ] **Step 1: Write failing standings/finals/report tests**

Test competition/dense/ordinal ranks, unresolved ties, configured tie breaks, “Why this rank?”, no leader/podium before results, animated rank-delta text, finals cutoff tie actions, playoff generation, separate finals standings, champion official seal, all required chart titles/takeaways/tables, and print-mode control hiding.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm playwright test tests/e2e/solo-standings.spec.ts tests/e2e/solo-finals-reports.spec.ts --project=chromium`  
Expected: FAIL because analytics/finals are absent.

- [ ] **Step 3: Implement standings and proof projection**

Render semantic tables with per-match wins, total, completed, timing, tie, and qualification. Apply competition/dense/ordinal logic and make each tied row's proof explain comparator equality or the exact resolving key.

- [ ] **Step 4: Implement responsive visualizations and motion**

Add completion ring, payment/category donuts, win bars/lollipops, cumulative match lines, lane-balance bars, pair-frequency matrix, and podium. Every chart includes a written takeaway and collapsible data table. Motion is 180–240ms, leaves persistent delta text, and becomes instant under reduced motion.

- [ ] **Step 5: Implement finals, reports, print, and share image**

Support automatic/manual finalists, tied-cutoff actions, fixed finals15/custom balanced finals, reset finals only, official seal, and no arbitrary champion. Print layouts cover registration, payments, schedule/cards, standings, podium, finals, and audit. A Canvas share card includes event/status/top standings and creator credit, with download and feature-detected native share.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm playwright test tests/e2e/solo-standings.spec.ts tests/e2e/solo-finals-reports.spec.ts --project=chromium`  
Expected: PASS.

```powershell
git add single-file/index.html tests/e2e
git commit -m "feat: add solo analytics finals and reports"
```

### Task 5: Diagnostics, embedded tests, accessibility, and offline artifact gate

**Files:**
- Modify: `single-file/index.html`
- Create: `scripts/verify-single-file.mjs`
- Test: `tests/e2e/solo-diagnostics.spec.ts`
- Test: `tests/e2e/solo-accessibility.spec.ts`

**Interfaces:**
- Produces embedded `runAllTests()`, copyable report, manual checklist, sanitized diagnostic log.

- [ ] **Step 1: Write failing artifact/diagnostic/accessibility tests**

Assert embedded tests include every schedule, scoring, ranking, payment, persistence/import, CSV, timing, and scheduler-quality group from the source specification; run isolated; preserve live state; return passed/failed/total; and produce no uncaught exception. Test all views, dialogs, focus return, Escape, keyboard operations, 320px layout, reduced motion, long names, empty states, and theme contrast smoke checks.

- [ ] **Step 2: Run tests to prove failure**

Run: `pnpm playwright test tests/e2e/solo-diagnostics.spec.ts tests/e2e/solo-accessibility.spec.ts --project=chromium`  
Expected: FAIL because the complete harness/checklist is missing.

- [ ] **Step 3: Complete the dependency-free harness and Diagnostics view**

Use cloned fixtures for tests. Show grouped results, readable expected/actual messages, copy report, environment/storage state, sanitized caught errors, schedule integrity, and the exact manual checklist from the supplied specification.

- [ ] **Step 4: Implement the static artifact verifier**

The verifier parses `single-file/index.html`, requires one runtime file, creator credit, nine views, four presets, self-test entry point, print/reduced-motion CSS, and rejects remote URLs in runtime-bearing attributes, unsafe handlers/APIs, `TODO|FIXME|implement later|same as above|pseudocode`, and missing selectors referenced by `getElementById/querySelector`.

- [ ] **Step 5: Run the full Solo gate**

Run: `node scripts/verify-single-file.mjs && pnpm playwright test tests/e2e/solo-*.spec.ts`  
Expected: all tests pass in Chromium, Firefox, and WebKit projects configured by the root test setup.

- [ ] **Step 6: Commit**

```powershell
git add single-file/index.html scripts/verify-single-file.mjs tests/e2e
git commit -m "test: verify complete offline solo edition"
```
