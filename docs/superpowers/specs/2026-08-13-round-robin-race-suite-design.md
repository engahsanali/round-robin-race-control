# Round Robin Race Suite — Product and Architecture Design

Date: 2026-08-13  
Status: Approved for implementation by the user's explicit request for both editions and subagent-driven execution

## 1. Outcome

Build a public, production-quality three-lane round-robin race-event suite that corrects and substantially improves the source workbook. The suite ships in one new public GitHub repository under `engahsanali` and as two independently deployed Netlify projects:

1. **Solo Edition:** exactly one self-contained `index.html`, usable offline by double-clicking, with no external runtime dependency.
2. **Pro Edition:** an installable, framework-based web application with deeper analytics, an optimized event-day workflow, local-first version history, and presentation tools.

Both editions must reproduce the exact 9-car, 12-car, 15-car six-match, and fixed 15-car finals schedules from the workbook specification. Both must use the same versioned JSON event schema and produce equivalent official standings for the same event.

## 2. Product identity

The public-facing product name is **Round Robin Race Control**. The compact mark is **RR · 3**, communicating round robin and three lanes.

Every edition displays the human credit exactly as:

> Made by Cesar Lacsamana and Ahsan Ali

The credit appears in the main shell, About panel, exported reports, and print layouts. It is a visible product mark, not buried legal text.

The visual language is event-day race control: deep graphite surfaces, high-contrast white, electric cyan, signal lime, and podium gold/silver/bronze. Typography uses fast system fonts only in Solo and bundled/local framework assets in Pro. Motion is purposeful: it confirms state transitions, progress, rank movement, and winners. Reduced-motion preferences replace movement with instant state changes.

## 3. Repository shape

```text
/
  README.md
  LICENSE
  package.json
  pnpm-workspace.yaml
  docs/
    research/
    superpowers/specs/
    superpowers/plans/
  fixtures/
    schedules.json
    demo-event.json
    schema/
  single-file/
    index.html
    netlify.toml
  apps/
    pro/
      index.html
      public/
      src/
      netlify.toml
  packages/
    domain/
    scheduler/
  tests/
    contract/
    e2e/
```

`fixtures/schedules.json` is the canonical machine-readable transcription of the four workbook presets. Contract tests compare the Solo embedded presets and Pro domain presets with this canonical file.

The Solo runtime remains genuinely standalone. Repository tooling may verify or regenerate it, but the delivered `single-file/index.html` requires no server, package installation, network, or companion file.

## 4. Versioned event data

Both editions use schema version 1:

- Event identity, venue, organizer, dates, status, audit timestamps.
- Settings for schedule mode, seed, rankings, tie breaks, timing, categories, prices, finals, confirmation, theme, and presentation.
- Stable-ID participants, car entries, payments, preliminary heats, finals heats, official results, audit log, and snapshot metadata.
- Money stored as integer cents.
- Official wins derived only from completed heat records whose winner belongs to that heat.
- Withdrawn cars retained for history but excluded from future scheduling.

Solo persists the current and previous valid snapshots in namespaced `localStorage`. Pro uses IndexedDB for the live event and bounded snapshot history, with a small localStorage bootstrap marker. Both support atomic JSON import, JSON export, guarded reset, previous-save restoration, and CSV exports protected against formula injection.

## 5. Scheduling engine

### Fixed presets

Preset arrays exactly match the supplied workbook specification:

- 9 cars: 4 matches × 3 heats.
- 12 cars: 5 matches × 4 heats.
- 15 cars: 6 matches × 5 heats; no empty Match 7.
- Finals preset: 15 cars, 5 matches × 5 heats.

Slots map to active cars in ascending car-number order by default and can be manually remapped before activation. Every activation runs a fairness and integrity validator.

### Custom schedules

The custom generator is deterministic for the same ordered entrants, configuration, and seed. It creates candidate match partitions, assigns lanes, and improves them with a bounded seeded local search.

The lexicographic quality objective is:

1. Eliminate invalid heats and duplicate appearances within a match.
2. Minimize the maximum difference in total appearances.
3. Minimize repeated opponent pairs, heavily penalizing third and later meetings.
4. Minimize each car's lane-count spread.
5. Minimize consecutive byes/two-car heats for the same car.
6. Minimize immediate repeat opponents and consecutive lane reuse.

The generator evaluates multiple deterministic restarts, preserves the best schedule by a stable comparison key, and stops at the configured iteration budget. Counts not divisible by three use labeled two-car heats or byes, allocated so appearance difference is at most one where mathematically possible. The quality report explains unavoidable imbalance instead of claiming false perfection.

Metrics include appearances, lane 1/2/3 counts, pair-frequency matrix, repeat-opponent total and maximum, bye/two-car distribution, appearance imbalance, lane imbalance, warnings, and an overall status of Valid, Valid with warnings, or Invalid.

## 6. Scoring, ranking, and finals

Standings are pure projections from event state. They show rank, participant, car, category, per-match wins, total wins, completed heats, optional average and best time, tie status, qualification status, and form over recent matches.

Ranking modes:

- Competition: 1, 2, 2, 4.
- Dense: 1, 2, 2, 3.
- Ordinal only when configured tie breaks resolve every tie.

Tie-break options are total wins, head-to-head within the tied set, matches won, best average time, best time, lane-balance score, playoff required, and optionally car number ascending. Car number is never silently used as a competitive tie break.

The podium remains empty until at least one official result exists. Qualification ties at the cutoff are surfaced with include-all, playoff, or reason-required manual resolution. Preliminary and finals standings remain separate. Champion publication requires completed finals or a reasoned manual decision recorded in the audit log.

## 7. Solo Edition experience

The single file contains all HTML, CSS, JavaScript, inline icons, print CSS, templates, schema validation, demo data, tests, and help.

Primary views:

1. Dashboard
2. Registration & Fees
3. Race Setup
4. Live Racing
5. Standings
6. Finals
7. Reports
8. Settings
9. Diagnostics

It includes:

- Guided setup wizard and clearly separate demo event.
- Accessible participant/car/payment editing with precise inline errors.
- Large touch and keyboard winner controls; 1/2/3 select lanes, Enter confirms, arrows navigate, U undoes.
- Dependency-free Canvas charts for completion, wins, payments, categories, and lane balance.
- CSS counter, page, chart, rank-change, and winner animations.
- Search/filter/sort controls that never mutate business IDs.
- Theme persistence, print layouts, audit history, JSON/CSV workflows, optional timing, and diagnostics.
- An embedded isolated test harness with schedule, scoring, ranking, payment, persistence/import, CSV, timing, and scheduler-quality groups.

## 8. Pro Edition experience

The Pro Edition uses React, TypeScript, Vite, a PWA service worker, IndexedDB, a declarative chart library, and an animation library. Domain and scheduler code remain framework-independent packages.

It includes everything in Solo plus:

- **Race Command Center:** responsive dockable live heat, next heat, leader pulse, issue queue, keyboard palette, and wake-lock control.
- **Spectator Board:** full-screen projector-friendly display synchronized between same-origin tabs through BroadcastChannel, without sending data to a server.
- **Schedule Lab:** compare deterministic candidate schedules, visualize opponent networks and pair-frequency heatmaps, and activate only a validated candidate.
- **Replay Timeline:** inspect and restore bounded local snapshots; winner changes show before/after standings impact.
- **Insight Studio:** animated ranking history, win distribution, category comparisons, lane-bias indicators, consistency, head-to-head explorer, and qualification projections clearly labeled as provisional.
- **Announcer Mode:** optional browser speech for heat calls and winner confirmation, with explicit enable/disable control.
- **Event Pack:** one action exports the event JSON, printable schedule, registration CSV, fees CSV, results CSV, standings CSV, audit CSV, and a human-readable summary.
- **Cross-edition transfer:** import an event from Solo and continue in Pro, or export a schema-compatible snapshot back.
- **Installability and offline shell:** after first load, the app can reopen without network access. Update availability is announced and never forces a reload during a live event.
- **Presentation polish:** celebratory winner moment, podium reveal, full-screen mode, share-preview artwork, and privacy-respecting local-only operation.

Pro does not claim multi-device live sync because no backend is in scope. Same-browser tab synchronization is explicitly labeled.

## 9. Charts and visual storytelling

The dashboard prioritizes facts operators need:

- Event completion ring and current/next heat.
- Active cars, heats complete/remaining, unresolved ties.
- Revenue, collected, and outstanding.
- Current leader only after official results.
- Recent audit activity.

Analytics views add:

- Animated horizontal leaderboard with rank-change indicators.
- Match-by-match cumulative win lines.
- Win-distribution bars.
- Lane-balance stacked bars.
- Opponent-repeat matrix/network.
- Category and payment donuts.
- Schedule quality radar only where its normalized axes are explained.
- Finals qualification cutoff band.

Charts provide text/table equivalents, accessible labels or summaries, keyboard-reachable controls, and never communicate status only by color.

## 10. Safety, accessibility, and robustness

- Practical WCAG 2.2 AA: semantic landmarks, native controls, labeled fields, visible focus, non-color status, dialog focus return, live regions, 44px touch targets, 320px support, and reduced motion.
- Imported/user text is untrusted and rendered with text-safe APIs.
- No `eval`, `Function`, `document.write`, unsafe inline handlers, or execution of imported content.
- Input lengths and participant/heat counts are bounded.
- Import rejects duplicate IDs, duplicate active car numbers, missing IDs, prototype-pollution keys, invalid winner references, unsupported versions, and impossible amounts/times.
- Failed imports never replace the current event.
- Global error capture records sanitized diagnostics without exposing raw traces to ordinary users.
- Destructive changes require confirmation and are reversible where practical.

## 11. Testing and verification

### Domain and contract tests

- Exact preset arrays and fairness invariants.
- Deterministic custom generation, stable seed behavior, lane and appearance balance, repeat minimization, and odd-count handling.
- Scoring, winner changes, cancellations, reruns, partial results, ties, ranking modes, and finals cutoff behavior.
- Integer-cent fees, partial/full/over/refund payments, and price changes.
- Serialization, migration, atomic import, ID stability, CSV escaping/injection protection, and invalid data rejection.
- Cross-edition schema and preset parity.

### Browser verification

- Solo opens from `file://` without network requests or console errors.
- Both Netlify URLs load, navigate every view, create an event, add entrants, activate a schedule, enter/change/undo a winner, update standings, export/import, switch themes, and run built-in tests.
- Responsive checks at 320px, tablet, desktop, and projector widths.
- Keyboard, focus, dialog, reduced-motion, print, long-name, and empty-state checks.
- Pro installability/offline shell, BroadcastChannel spectator mode, IndexedDB snapshots, and update notice.

### Release evidence

- Fresh automated tests and production builds.
- Source scans for external runtime dependencies in Solo, unsafe APIs, missing credit, incomplete markers, and leaked secrets.
- Independent HTTP checks for status, title, security headers, and expected product copy on both production URLs.
- GitHub repository read-back of owner, visibility, default branch, commit SHA, and clean local/remote parity.
- Netlify project/deploy read-back for two distinct site IDs and production deploys.
- Sent-email read-back verifying recipient, subject, and both live links.

## 12. Publication

Repository target: a new public repository under `engahsanali`, default branch `main`.

Netlify target: two distinct public projects:

- Solo project publishes `single-file/` without a build command.
- Pro project builds the workspace-filtered Pro application and publishes its `dist/`.

Both projects receive restrictive security headers compatible with their runtime. Continuous deployment is configured from the shared repository or a verified equivalent GitHub workflow, and each site's deploy metadata identifies the same release commit.

After production verification, the referenced Codex task receives the repository URL, both Netlify URLs, project identity, release commit, and verification summary. A concise completion email is sent to `engahsanali@hotmail.com` with both playable links and the repository link, then the Sent item is read back before delivery is claimed.

## 13. Explicit non-goals

- No user accounts, cloud database, payment processing, or remote participant contact.
- No claim of cross-device live synchronization.
- No arbitrary champion selection when competitive ties remain unresolved.
- No hidden analytics, advertising, or third-party tracking.
- No reproduction of the workbook's broken formulas, empty Match 7, double-fee multiplication, or placeholder-winner behavior.
